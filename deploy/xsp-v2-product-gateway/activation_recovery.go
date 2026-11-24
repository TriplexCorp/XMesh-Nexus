package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

const activationRecoveryPath = "/api/v1/node/agent-activation-recovery"

// This operation is reachable only inside a freshly signed strict XSP/2
// tunnel, whose mTLS SPKI, key epoch and *enrolled* release are checked by
// tunnel() before this handler. It cannot create or change an activation.
type activationRecoveryRequest struct {
	Schema             string `json:"schema"`
	OriginalRequestID  string `json:"originalRequestId"`
	OriginalSHA256     string `json:"originalSha256"`
}

func decodeActivationRecovery(raw []byte) (activationRecoveryRequest, error) {
	var claim activationRecoveryRequest
	if len(raw) == 0 || len(raw) > 1024 || checkUniqueJSONKeys(raw) != nil {
		return claim, errors.New("invalid activation recovery request")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&claim); err != nil {
		return claim, err
	}
	if decoder.Decode(new(any)) != io.EOF ||
		claim.Schema != "xmesh-product-activation-recovery-v1" ||
		len(claim.OriginalRequestID) != 32 || !isLowerHex(claim.OriginalRequestID) ||
		len(claim.OriginalSHA256) != sha256.Size*2 || !isLowerHex(claim.OriginalSHA256) {
		return claim, errors.New("invalid activation recovery binding")
	}
	return claim, nil
}

func recoverActivationReceipt(n nodeIdentity, raw []byte) (int, []byte) {
	claim, err := decodeActivationRecovery(raw)
	if err != nil {
		return http.StatusBadRequest, []byte("{}")
	}
	if n.State != "active" || len(n.Receipt) == 0 || len(n.ActivationDigest) != sha256.Size ||
		n.ActivationRequestID != claim.OriginalRequestID {
		return http.StatusConflict, []byte("{}")
	}
	digest, err := hex.DecodeString(claim.OriginalSHA256)
	if err != nil || !bytes.Equal(n.ActivationDigest, digest) {
		return http.StatusConflict, []byte("{}")
	}
	// Never re-sign, refresh or alter the original receipt. Returning exact
	// persisted bytes lets the installed Agent finish its original
	// activation after an HTTP loss or a crash between local fsyncs.
	return http.StatusOK, append([]byte(nil), n.Receipt...)
}
