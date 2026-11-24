package main

import (
	"strings"
	"testing"
)

func TestForwardProductRelease(t *testing.T) {
	current := releaseIdentity{"control-v6.0.27", strings.Repeat("a", 40), strings.Repeat("b", 64)}
	target := releaseIdentity{"control-v6.0.28", strings.Repeat("c", 40), strings.Repeat("d", 64)}
	if !validForwardProductRelease(current, target) {
		t.Fatal("future first-release successor rejected")
	}
	for _, version := range []string{
		"control-v6.0.27", "control-v6.0.26", "control-v6.00.28", "control-v6.0.028",
		"control-v6.0.4294967296", "control-v7.0.0", "control-v6.0.28-rc1",
	} {
		wrong := target
		wrong.Version = version
		if validForwardProductRelease(current, wrong) {
			t.Errorf("invalid transition accepted: %s", version)
		}
	}
	for _, wrong := range []releaseIdentity{
		{target.Version, current.SourceRevision, target.ArtifactSHA256},
		{target.Version, target.SourceRevision, current.ArtifactSHA256},
		{target.Version, target.SourceRevision, strings.ToUpper(target.ArtifactSHA256)},
	} {
		if validForwardProductRelease(current, wrong) {
			t.Fatal("invalid successor identity accepted")
		}
	}
	if !forwardProductVersion("control-v6.0.99", "control-v6.1.0") ||
		!forwardProductVersion("control-v6.1.9", "control-v6.1.10") ||
		forwardProductVersion("control-v6.1.0", "control-v6.0.999") {
		t.Fatal("release version ordering is not numeric")
	}
}
