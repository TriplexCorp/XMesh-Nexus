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
	"strconv"

	"github.com/jackc/pgx/v5"
)

const (
	releaseCommitPath  = "/api/v1/node/agent-release-commit"
	releaseInstallPath = "/api/v1/node/agent-release-install"
	releaseAbortPath   = "/api/v1/node/agent-release-abort"
)

func (g *gateway) authorizeReleaseInstall(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte) (int, []byte) {
	if os.Getenv("XSP_V2_PRODUCT_RELEASE_COMMIT") != "1" {
		return http.StatusNotFound, []byte("{}")
	}
	return g.loadReleasePlan(ctx, parsed, n, body, false)
}

type releaseCommitRequest struct {
	CommandID  int64           `json:"commandId"`
	PlanSHA256 string          `json:"planSha256"`
	Installed  releaseIdentity `json:"installed"`
}

type releaseCommitReceipt struct {
	Schema           string          `json:"schema"`
	NodeID           int64           `json:"nodeId"`
	CommandID        int64           `json:"commandId"`
	ActivationSHA256 string          `json:"activationSha256"`
	PlanSHA256       string          `json:"planSha256"`
	Installed        releaseIdentity `json:"installed"`
}

func (g *gateway) effectiveRelease(ctx context.Context, n nodeIdentity, nodeID int64) (releaseIdentity, error) {
	activation := sha256.Sum256(n.Receipt)
	var effective releaseIdentity
	var manifestRevision string
	err := g.db.QueryRow(ctx, `SELECT rc.source_revision,m.version,m.artifact_sha256,m.source_revision
        FROM node_xsp_product_release_commits rc
        JOIN node_restart_commands c ON c.id=rc.command_id AND c.node_id=rc.node_id
        JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
        WHERE rc.node_id=$1 AND rc.activation_sha256=$2`,
		nodeID, activation[:]).Scan(&effective.SourceRevision, &effective.Version, &effective.ArtifactSHA256, &manifestRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		return n.Release, nil
	}
	if err != nil {
		return releaseIdentity{}, err
	}
	if effective.SourceRevision != manifestRevision || !validForwardProductRelease(n.Release, effective) {
		return releaseIdentity{}, errors.New("committed release identity mismatch")
	}
	return effective, nil
}

func (g *gateway) effectiveReleaseRevision(ctx context.Context, n nodeIdentity, nodeID int64) (string, error) {
	effective, err := g.effectiveRelease(ctx, n, nodeID)
	return effective.SourceRevision, err
}

// Only the holding node can commit the exact approved target. This is a
// proof from its measured updater, not remote hardware attestation.
func (g *gateway) commitRelease(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte) (int, []byte) {
	return g.finishRelease(ctx, parsed, n, body, false)
}

func (g *gateway) finishRelease(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte, abort bool) (int, []byte) {
	empty := []byte("{}")
	var req releaseCommitRequest
	if len(body) > 2048 || checkUniqueJSONKeys(body) != nil {
		return http.StatusBadRequest, empty
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&req) != nil || decoder.Decode(new(any)) != io.EOF || req.CommandID <= 0 {
		return http.StatusBadRequest, empty
	}
	expectedRevision := req.Installed.SourceRevision
	if abort {
		expectedRevision = n.Release.SourceRevision
	}
	if !validForwardProductRelease(n.Release, req.Installed) || parsed.Env.Revision != expectedRevision ||
		len(n.Receipt) == 0 {
		return http.StatusConflict, empty
	}

	tx, err := g.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL synchronous_commit = on"); err != nil {
		return http.StatusServiceUnavailable, empty
	}
	nodeID := parsed.Env.NodeID
	activation := sha256.Sum256(n.Receipt)
	var signedPlan []byte
	var approved releaseIdentity
	var eligible bool
	var commandState string
	err = tx.QueryRow(ctx, `SELECT o.signed_envelope,m.version,m.source_revision,m.artifact_sha256,
            c.state, c.state='claimed' AND c.claimed_at IS NOT NULL
                AND LEAST(c.requested_at,c.claimed_at) > clock_timestamp()-interval '15 minutes'
        FROM node_restart_commands c
        JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
        JOIN node_xsp_product_release_plans o ON o.command_id=c.id
        JOIN node_xsp_product_nodes p ON p.node_id=c.node_id
        JOIN node_xsp_public_keysets k ON k.node_id=p.node_id AND k.purpose='node_request'
          AND k.key_epoch=p.key_epoch AND k.ed25519_key_id=p.ed25519_key_id
          AND k.mldsa65_key_id=p.mldsa65_key_id AND k.revoked_at IS NULL
        JOIN panel_records d ON d.id=p.node_id AND d.collection='nodes'
        WHERE c.id=$1 AND p.node_id=$2 AND c.action='update_agent'
          AND p.state='active' AND p.key_epoch=$3 AND p.receipt_sha256=$4
          AND o.activation_sha256=p.receipt_sha256 AND c.target_version=m.version
          AND p.release_version=$5 AND p.release_source_revision=$6 AND p.release_artifact_sha256=$7
          AND (d.data->'disabled') IS DISTINCT FROM 'true'::jsonb
        FOR UPDATE OF c,p FOR SHARE OF k,d`, req.CommandID, nodeID, n.KeyEpoch,
		activation[:], n.Release.Version, n.Release.SourceRevision, n.Release.ArtifactSHA256).
		Scan(&signedPlan, &approved.Version, &approved.SourceRevision, &approved.ArtifactSHA256, &commandState, &eligible)
	if errors.Is(err, pgx.ErrNoRows) {
		return http.StatusConflict, empty
	}
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	planHash := sha256.Sum256(signedPlan)
	if approved != req.Installed || hex.EncodeToString(planHash[:]) != req.PlanSHA256 {
		return http.StatusConflict, empty
	}
	var saved []byte
	var committedCommand int64
	var committedPlan []byte
	err = tx.QueryRow(ctx, `SELECT command_id,plan_sha256,signed_envelope
        FROM node_xsp_product_release_commits WHERE node_id=$1 AND activation_sha256=$2`,
		nodeID, activation[:]).Scan(&committedCommand, &committedPlan, &saved)
	if err == nil {
		if abort || committedCommand != req.CommandID || !bytes.Equal(committedPlan, planHash[:]) {
			return http.StatusConflict, empty
		}
		if tx.Commit(ctx) != nil {
			return http.StatusServiceUnavailable, empty
		}
		return http.StatusOK, saved
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return http.StatusServiceUnavailable, empty
	}
	if !abort && (!eligible || approved.Version != g.approvedReleaseTarget() || os.Getenv("XSP_V2_PRODUCT_RELEASE_COMMIT") != "1") {
		return http.StatusConflict, empty
	}

	// Recheck the signed deadline, so changing command timestamps cannot
	// extend a previously approved plan.
	signed, err := parseEnvelope(signedPlan, "panel.product.release-plan", releasePlanPath, 2)
	var plan releasePlan
	if err != nil || json.Unmarshal(signed.Payload, &plan) != nil ||
		plan.NodeID != nodeID || plan.CommandID != req.CommandID || plan.Current != n.Release ||
		plan.Target != approved || plan.KeyEpoch != n.KeyEpoch ||
		plan.ActivationSHA256 != hex.EncodeToString(activation[:]) {
		return http.StatusConflict, empty
	}
	if abort {
		// Commit and abort hold the same command and enrollment locks. A
		// signed abort is issued only once the pending command can no
		// longer commit. Repeating an already aborted request is safe.
		if commandState != "claimed" && commandState != "failed" {
			return http.StatusConflict, empty
		}
		if commandState == "claimed" {
			if _, err := tx.Exec(ctx, `UPDATE node_restart_commands SET state='failed',
                finished_at=clock_timestamp(),result='Strict XSP/2 release aborted' WHERE id=$1`, req.CommandID); err != nil {
				return http.StatusServiceUnavailable, empty
			}
		}
		payload, err := json.Marshal(releaseCommitReceipt{
			Schema: "xmesh-product-agent-release-abort-v1", NodeID: nodeID, CommandID: req.CommandID,
			ActivationSHA256: plan.ActivationSHA256, PlanSHA256: req.PlanSHA256, Installed: approved,
		})
		if err != nil {
			return http.StatusServiceUnavailable, empty
		}
		raw, err := g.signResponse(nodeID, n.KeyEpoch, "panel.product.release-abort", releaseAbortPath,
			strconv.FormatInt(req.CommandID, 10), approved.SourceRevision, payload)
		if err != nil || tx.Commit(ctx) != nil {
			return http.StatusServiceUnavailable, empty
		}
		return http.StatusOK, raw
	}
	payload, err := json.Marshal(releaseCommitReceipt{
		Schema: "xmesh-product-agent-release-commit-v1", NodeID: nodeID, CommandID: req.CommandID,
		ActivationSHA256: plan.ActivationSHA256, PlanSHA256: req.PlanSHA256, Installed: approved,
	})
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	saved, err = g.signResponse(nodeID, n.KeyEpoch, "panel.product.release-commit", releaseCommitPath,
		strconv.FormatInt(req.CommandID, 10), approved.SourceRevision, payload)
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	_, err = tx.Exec(ctx, `INSERT INTO node_xsp_product_release_commits
        (command_id,node_id,activation_sha256,plan_sha256,source_revision,signed_envelope)
        VALUES($1,$2,$3,$4,$5,$6)`, req.CommandID, nodeID, activation[:], planHash[:], approved.SourceRevision, saved)
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	result, err := tx.Exec(ctx, `UPDATE node_restart_commands
        SET state='succeeded', finished_at=clock_timestamp(), result='Strict XSP/2 release confirmed',
            release_ack_version=$2, release_ack_source_revision=$3, release_ack_artifact_sha256=$4,
            release_ack_success=true, release_ack_received_at=clock_timestamp()
        WHERE id=$1 AND state='claimed'
          AND clock_timestamp() < to_timestamp($5::double precision / 1000)`,
		req.CommandID, approved.Version, approved.SourceRevision, approved.ArtifactSHA256, plan.ExpiresAtMS)
	if err != nil {
		return http.StatusServiceUnavailable, empty
	}
	if result.RowsAffected() != 1 {
		return http.StatusConflict, empty
	}
	if tx.Commit(ctx) != nil {
		return http.StatusServiceUnavailable, empty
	}
	return http.StatusOK, saved
}
