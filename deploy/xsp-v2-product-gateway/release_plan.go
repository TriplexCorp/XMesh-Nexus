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

const releasePlanPath = "/api/v1/node/agent-release-plan"

type releasePlanRequest struct {
	CommandID int64           `json:"commandId"`
	Current   releaseIdentity `json:"current"`
}

type releasePlan struct {
	Schema           string          `json:"schema"`
	NodeID           int64           `json:"nodeId"`
	KeyEpoch         int64           `json:"keyEpoch"`
	CommandID        int64           `json:"commandId"`
	ExpiresAtMS      int64           `json:"expiresAtMs"`
	ActivationSHA256 string          `json:"activationSha256"`
	Current          releaseIdentity `json:"current"`
	Target           releaseIdentity `json:"target"`
}

func decodeReleasePlanRequest(body []byte) (releasePlanRequest, error) {
	var request releasePlanRequest
	if len(body) > 2048 || checkUniqueJSONKeys(body) != nil {
		return request, errors.New("invalid plan request")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if decoder.Decode(new(any)) != io.EOF || request.CommandID <= 0 {
		return request, errors.New("invalid plan command")
	}
	return request, nil
}

func (g *gateway) planRelease(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte) (int, []byte) {
	return g.loadReleasePlan(ctx, parsed, n, body, true)
}

func (g *gateway) loadReleasePlan(ctx context.Context, parsed parsedEnvelope, n nodeIdentity, body []byte, allowCreate bool) (int, []byte) {
	if os.Getenv("XSP_V2_PRODUCT_RELEASE_PLANNING") != "1" {
		return http.StatusNotFound, []byte("{}")
	}
	request, err := decodeReleasePlanRequest(body)
	if err != nil {
		return http.StatusBadRequest, []byte("{}")
	}
	if request.Current != n.Release || parsed.Env.Revision != n.Release.SourceRevision ||
		!forwardProductVersion(n.Release.Version, targetAgentVersion) || len(n.Receipt) == 0 {
		return http.StatusConflict, []byte("{}")
	}
	tx, err := g.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return http.StatusServiceUnavailable, []byte("{}")
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "SET LOCAL synchronous_commit = on"); err != nil {
		return http.StatusServiceUnavailable, []byte("{}")
	}
	activation := sha256.Sum256(n.Receipt)
	var target releaseIdentity
	var expiry int64
	err = tx.QueryRow(ctx, `SELECT m.version, m.source_revision, m.artifact_sha256,
          (EXTRACT(EPOCH FROM LEAST(c.requested_at,c.claimed_at) + interval '15 minutes') * 1000)::BIGINT
        FROM node_restart_commands c
        JOIN node_xsp_agent_release_manifests m ON m.id=c.release_manifest_id
        JOIN node_xsp_product_nodes p ON p.node_id=c.node_id
        JOIN node_xsp_public_keysets k ON k.node_id=p.node_id AND k.purpose='node_request'
          AND k.key_epoch=p.key_epoch AND k.ed25519_key_id=p.ed25519_key_id
          AND k.mldsa65_key_id=p.mldsa65_key_id AND k.revoked_at IS NULL
        JOIN panel_records d ON d.id=p.node_id AND d.collection='nodes'
        WHERE c.id=$1 AND p.node_id=$2 AND c.state='claimed' AND c.action='update_agent'
          AND c.claimed_at IS NOT NULL
          AND LEAST(c.requested_at,c.claimed_at) > clock_timestamp() - interval '15 minutes'
          AND c.target_version=m.version AND m.version=$8
          AND p.state='active' AND p.key_epoch=$3 AND p.receipt_sha256=$4
          AND p.release_version=$5 AND p.release_source_revision=$6 AND p.release_artifact_sha256=$7
          AND (d.data->'disabled') IS DISTINCT FROM 'true'::jsonb
        FOR UPDATE OF c FOR SHARE OF p,k,d`, request.CommandID, parsed.Env.NodeID, n.KeyEpoch,
		activation[:], n.Release.Version, n.Release.SourceRevision, n.Release.ArtifactSHA256, targetAgentVersion).
		Scan(&target.Version, &target.SourceRevision, &target.ArtifactSHA256, &expiry)
	if errors.Is(err, pgx.ErrNoRows) {
		return http.StatusConflict, []byte("{}")
	}
	if err != nil {
		return http.StatusServiceUnavailable, []byte("{}")
	}
	if !validForwardProductRelease(n.Release, target) {
		return http.StatusConflict, []byte("{}")
	}
	var activationStored, receipt []byte
	err = tx.QueryRow(ctx, "SELECT activation_sha256,signed_envelope FROM node_xsp_product_release_plans WHERE command_id=$1",
		request.CommandID).Scan(&activationStored, &receipt)
	if err == nil && !bytes.Equal(activation[:], activationStored) {
		return http.StatusConflict, []byte("{}")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if !allowCreate {
			return http.StatusConflict, []byte("{}")
		}
		plan := releasePlan{Schema: "xmesh-product-agent-release-plan-v1",
			NodeID: parsed.Env.NodeID, KeyEpoch: n.KeyEpoch, CommandID: request.CommandID,
			ExpiresAtMS: expiry, ActivationSHA256: hex.EncodeToString(activation[:]), Current: n.Release, Target: target}
		payload, encodeErr := json.Marshal(plan)
		if encodeErr != nil {
			return http.StatusInternalServerError, []byte("{}")
		}
		receipt, err = g.signResponse(parsed.Env.NodeID, n.KeyEpoch, "panel.product.release-plan",
			releasePlanPath, strconv.FormatInt(request.CommandID, 10), target.SourceRevision, payload)
		if err == nil {
			_, err = tx.Exec(ctx, "INSERT INTO node_xsp_product_release_plans(command_id,activation_sha256,signed_envelope) VALUES($1,$2,$3)",
				request.CommandID, activation[:], receipt)
		}
	}
	if err != nil || tx.Commit(ctx) != nil {
		return http.StatusServiceUnavailable, []byte("{}")
	}
	return http.StatusOK, receipt
}
