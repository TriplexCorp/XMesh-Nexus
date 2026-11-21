package main

import (
	"strings"
	"testing"
)

func TestPinnedWALCandidateRequiresEnabledTransportAndExactBinary(t *testing.T) {
	revision, artifact := strings.Repeat("a", 40), strings.Repeat("b", 64)
	release := releaseIdentity{
		Version: "control-v6.0.25", SourceRevision: revision, ArtifactSHA256: artifact,
	}
	pin := revision + ":" + artifact
	if !pinnedWALCandidate(release, "1", pin) {
		t.Fatal("exact WAL rehearsal binary was rejected")
	}
	for _, mismatch := range []struct{ enabled, pin string }{
		{"0", pin}, {"1", ""}, {"1", strings.Repeat("c", 40) + ":" + artifact},
		{"1", revision + ":" + strings.Repeat("c", 64)}, {"1", strings.ToUpper(pin)},
	} {
		if pinnedWALCandidate(release, mismatch.enabled, mismatch.pin) {
			t.Fatalf("unexpected WAL candidate match: %q", mismatch)
		}
	}
}
