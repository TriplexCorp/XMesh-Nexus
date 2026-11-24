package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestActivationRecoveryReturnsExactDurableReceiptOnly(t *testing.T) {
	request := []byte("original dual-signed activation request")
	digest := sha256.Sum256(request)
	receipt := []byte("original panel-signed activation receipt")
	node := nodeIdentity{
		State: "active", ActivationRequestID: strings.Repeat("a", 32),
		ActivationDigest: digest[:], Receipt: receipt,
	}
	claim := activationRecoveryRequest{
		Schema: "xmesh-product-activation-recovery-v1",
		OriginalRequestID: node.ActivationRequestID,
		OriginalSHA256: hex.EncodeToString(digest[:]),
	}
	call := func(c activationRecoveryRequest) (int, []byte) {
		raw, err := json.Marshal(c)
		if err != nil { t.Fatal(err) }
		return recoverActivationReceipt(node, raw)
	}
	status, result := call(claim)
	if status != http.StatusOK || !bytes.Equal(result, receipt) {
		t.Fatal("original durable receipt recovery failed")
	}
	result[0] ^= 1
	if !bytes.Equal(node.Receipt, receipt) {
		t.Fatal("recovery caller mutated the stored receipt")
	}
	for label, mutate := range map[string]func(*activationRecoveryRequest){
		"different request": func(c *activationRecoveryRequest) { c.OriginalRequestID = strings.Repeat("b", 32) },
		"different digest": func(c *activationRecoveryRequest) { c.OriginalSHA256 = strings.Repeat("0", 64) },
		"wrong schema": func(c *activationRecoveryRequest) { c.Schema = "unknown" },
	} {
		t.Run(label, func(t *testing.T) {
			c := claim
			mutate(&c)
			status, _ := call(c)
			if status == http.StatusOK { t.Fatal("unrelated receipt disclosed") }
		})
	}
	for _, state := range []string{"enrolled", "disabled", "retired"} {
		node.State = state
		if status, _ := call(claim); status == http.StatusOK {
			t.Fatalf("inactive node recovered receipt: %s", state)
		}
	}
	node.State = "active"
	node.Receipt = nil
	if status, _ := call(claim); status == http.StatusOK {
		t.Fatal("empty receipt accepted")
	}
	duplicate := []byte(`{"schema":"xmesh-product-activation-recovery-v1","originalRequestId":"`+
		strings.Repeat("a",32)+`","originalSha256":"`+hex.EncodeToString(digest[:])+`","originalSha256":"`+
		hex.EncodeToString(digest[:])+`"}`)
	if status, _ := recoverActivationReceipt(node, duplicate); status != http.StatusBadRequest {
		t.Fatal("duplicate claim accepted")
	}
}
