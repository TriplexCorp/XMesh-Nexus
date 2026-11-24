package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const (
	releaseArtifactPath     = "/api/v1/node/agent-release-artifact"
	releaseChunkBytes       = 128 * 1024
	maxReleaseArtifactBytes = 64 * 1024 * 1024
)

type releaseArtifactRequest struct {
	CommandID  int64           `json:"commandId"`
	Current    releaseIdentity `json:"current"`
	PlanSHA256 string          `json:"planSha256"`
	Offset     int64           `json:"offset"`
}

type releaseArtifactChunk struct {
	PlanSHA256     string `json:"planSha256"`
	ArtifactSHA256 string `json:"artifactSha256"`
	Offset         int64  `json:"offset"`
	TotalBytes     int64  `json:"totalBytes"`
	DataB64        string `json:"dataB64"`
}

func decodeReleaseArtifactRequest(body []byte) (releaseArtifactRequest, error) {
	var req releaseArtifactRequest
	if len(body) > 2048 || checkUniqueJSONKeys(body) != nil {
		return req, errors.New("invalid artifact request")
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(&req); err != nil {
		return req, err
	}
	if d.Decode(new(any)) != io.EOF || req.CommandID <= 0 ||
		len(req.PlanSHA256) != 64 || !isLowerHex(req.PlanSHA256) ||
		req.Offset < 0 || req.Offset >= maxReleaseArtifactBytes || req.Offset % releaseChunkBytes != 0 {
		return req, errors.New("invalid artifact chunk coordinates")
	}
	return req, nil
}

// A successful stat is not proof that <sha256>.bin contains those bytes.
// Cache a VERIFIED digest only while the same Linux inode, size, mtime and
// ctime remain unchanged. Re-hashing 64 MiB for each 128 KiB chunk would
// make one legitimate download read ~32 GiB and create a denial of service.
type releaseArtifactIdentity struct {
	digest        string
	dev, ino      uint64
	size          int64
	modified      syscall.Timespec
	changed       syscall.Timespec
}

var releaseVerifiedArtifacts = struct {
	sync.Mutex
	entries map[releaseArtifactIdentity]struct{}
}{entries: make(map[releaseArtifactIdentity]struct{})}

func releaseArtifactFingerprint(digest string, info os.FileInfo) (releaseArtifactIdentity, error) {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return releaseArtifactIdentity{}, errors.New("artifact has no kernel identity")
	}
	return releaseArtifactIdentity{
		digest: digest, dev: uint64(st.Dev), ino: st.Ino,
		size: info.Size(), modified: st.Mtim, changed: st.Ctim,
	}, nil
}

func verifyReleaseArtifactBytes(file *os.File, digest string, info os.FileInfo) error {
	initial, err := releaseArtifactFingerprint(digest, info)
	if err != nil {
		return err
	}
	// Serialize first verification: concurrent chunk requests must not all
	// hash the same big binary while an installer is preparing its next step.
	releaseVerifiedArtifacts.Lock()
	defer releaseVerifiedArtifacts.Unlock()
	_, cached := releaseVerifiedArtifacts.entries[initial]
	if !cached {
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return err
		}
		hash := sha256.New()
		n, err := io.CopyN(hash, file, info.Size())
		if err != nil || n != info.Size() {
			return errors.New("artifact changed during SHA-256 measurement")
		}
		if hex.EncodeToString(hash.Sum(nil)) != digest {
			return errors.New("artifact bytes differ from immutable manifest digest")
		}
	}
	after, err := file.Stat()
	if err != nil {
		return err
	}
	confirmed, err := releaseArtifactFingerprint(digest, after)
	if err != nil || confirmed != initial || after.Mode() != info.Mode() ||
		after.Size() != info.Size() {
		return errors.New("artifact changed during SHA-256 verification")
	}
	if !cached {
		if len(releaseVerifiedArtifacts.entries) >= 32 {
			clear(releaseVerifiedArtifacts.entries)
		}
		releaseVerifiedArtifacts.entries[initial] = struct{}{}
	}
	return nil
}

func readReleaseChunk(root, digest string, offset int64) ([]byte, int64, error) {
	if !filepath.IsAbs(root) || len(digest) != 64 || !isLowerHex(digest) ||
		offset < 0 || offset >= maxReleaseArtifactBytes || offset % releaseChunkBytes != 0 {
		return nil, 0, errors.New("invalid artifact coordinates")
	}
	dir, err := syscall.Open(root, syscall.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, 0, err
	}
	defer syscall.Close(dir)
	fd, err := syscall.Openat(dir, digest+".bin", syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, 0, err
	}
	file := os.NewFile(uintptr(fd), digest+".bin")
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return nil, 0, err
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Nlink != 1 || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 ||
		info.Size() <= 0 || info.Size() > maxReleaseArtifactBytes || offset >= info.Size() {
		return nil, 0, errors.New("unsafe or out-of-range artifact")
	}
	if err := verifyReleaseArtifactBytes(file, digest, info); err != nil {
		return nil, 0, err
	}
	size := min(int64(releaseChunkBytes), info.Size()-offset)
	data := make([]byte, int(size))
	if _, err := file.ReadAt(data, offset); err != nil {
		return nil, 0, err
	}
	after, err := file.Stat()
	if err != nil {
		return nil, 0, err
	}
	priorID, priorErr := releaseArtifactFingerprint(digest, info)
	afterID, afterErr := releaseArtifactFingerprint(digest, after)
	if priorErr != nil || afterErr != nil || priorID != afterID ||
		after.Mode() != info.Mode() {
		return nil, 0, errors.New("artifact changed while serving chunk")
	}
	return data, info.Size(), nil
}

func (g *gateway) releaseArtifact(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte) (int, []byte) {
	if os.Getenv("XSP_V2_PRODUCT_RELEASE_PLANNING") != "1" {
		return http.StatusNotFound, []byte("{}")
	}
	req, err := decodeReleaseArtifactRequest(body)
	if err != nil {
		return http.StatusBadRequest, []byte("{}")
	}
	planRequest, err := json.Marshal(releasePlanRequest{CommandID: req.CommandID, Current: req.Current})
	if err != nil {
		return http.StatusBadRequest, []byte("{}")
	}
	// Recheck the live command, activation, key epoch and manifest per chunk.
	// A download cannot create a plan or authorize a runtime replacement.
	status, receipt := g.loadReleasePlan(ctx, parsed, n, planRequest, false)
	if status != http.StatusOK {
		return status, []byte("{}")
	}
	hash := sha256.Sum256(receipt)
	if hex.EncodeToString(hash[:]) != req.PlanSHA256 {
		return http.StatusConflict, []byte("{}")
	}
	signed, err := parseEnvelope(receipt, "panel.product.release-plan", releasePlanPath, 2)
	if err != nil {
		return http.StatusServiceUnavailable, []byte("{}")
	}
	var plan releasePlan
	activation := sha256.Sum256(n.Receipt)
	if err := json.Unmarshal(signed.Payload, &plan); err != nil ||
		plan.Schema != "xmesh-product-agent-release-plan-v1" ||
		plan.NodeID != parsed.Env.NodeID || plan.KeyEpoch != n.KeyEpoch || plan.CommandID != req.CommandID ||
		plan.ActivationSHA256 != hex.EncodeToString(activation[:]) ||
		plan.Current != n.Release || plan.Target.SourceRevision != signed.Env.Revision ||
		plan.Target.Version != g.approvedReleaseTarget() || !validForwardProductRelease(n.Release, plan.Target) ||
		plan.ExpiresAtMS <= time.Now().UnixMilli() {
		return http.StatusConflict, []byte("{}")
	}
	data, total, err := readReleaseChunk(os.Getenv("XSP_V2_PRODUCT_RELEASE_ARTIFACT_DIR"), plan.Target.ArtifactSHA256, req.Offset)
	if err != nil {
		return http.StatusConflict, []byte("{}")
	}
	chunk, err := json.Marshal(releaseArtifactChunk{
		PlanSHA256: req.PlanSHA256, ArtifactSHA256: plan.Target.ArtifactSHA256,
		Offset: req.Offset, TotalBytes: total, DataB64: b64.EncodeToString(data),
	})
	if err != nil {
		return http.StatusInternalServerError, []byte("{}")
	}
	return http.StatusOK, chunk
}
