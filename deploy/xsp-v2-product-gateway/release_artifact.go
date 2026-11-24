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
	"syscall"
	"time"
)

const (
	releaseArtifactPath = "/api/v1/node/agent-release-artifact"
	releaseChunkBytes = 128 * 1024
	maxReleaseArtifactBytes = 64 * 1024 * 1024
)

type releaseArtifactRequest struct {
	CommandID int64 `json:"commandId"`
	Current releaseIdentity `json:"current"`
	PlanSHA256 string `json:"planSha256"`
	Offset int64 `json:"offset"`
}

type releaseArtifactChunk struct {
	PlanSHA256 string `json:"planSha256"`
	ArtifactSHA256 string `json:"artifactSha256"`
	Offset int64 `json:"offset"`
	TotalBytes int64 `json:"totalBytes"`
	DataB64 string `json:"dataB64"`
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
	size := min(int64(releaseChunkBytes), info.Size()-offset)
	data := make([]byte, int(size))
	if _, err := file.ReadAt(data, offset); err != nil {
		return nil, 0, err
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
	if err := json.Unmarshal(signed.Payload, &plan); err != nil ||
		plan.NodeID != parsed.Env.NodeID || plan.CommandID != req.CommandID ||
		plan.Current != n.Release || plan.ExpiresAtMS <= time.Now().UnixMilli() {
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
