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

func TestFreshProductEnrollmentRequiresExactReleasePin(t *testing.T) {
	revision := strings.Repeat("a", 40)
	artifact := strings.Repeat("b", 64)
	pin := revision + ":" + artifact
	release := releaseIdentity{targetAgentVersion, revision, artifact}
	if !releaseAllowedForEnrollment(release, pin, "", "") {
		t.Fatal("reviewed release requires no WAL rehearsal flags")
	}
	for _, invalid := range []string{"", revision, revision + ":" + strings.Repeat("c", 64), strings.ToUpper(pin)} {
		if releaseAllowedForEnrollment(release, invalid, "", pin) {
			t.Fatal("accepted a missing or incorrect fresh-install pin")
		}
	}
	release.Version = "control-v6.0.24"
	if releaseAllowedForEnrollment(release, pin, "1", pin) {
		t.Fatal("legacy bootstrap accepted for a fresh enrollment")
	}
}

func TestCurrentWALCandidateRejectsRetiredVersion(t *testing.T) {
	revision, artifact := strings.Repeat("a", 40), strings.Repeat("b", 64)
	pin := revision + ":" + artifact
	release := releaseIdentity{targetAgentVersion, revision, artifact}
	if !pinnedWALCandidate(release, "1", pin) || pinnedWALCandidate(release, "0", pin) {
		t.Fatal("current WAL candidate must require the enabled exact rehearsal pin")
	}
	release.Version = "control-v6.0.27"
	if releaseAllowedForEnrollment(release, pin, "1", pin) {
		t.Fatal("retired 6.0.27 identity must not enroll with current release pins")
	}
}

func TestClassicImageCandidateIsNeverProductionEnrollment(t *testing.T) {
	revision, artifact := strings.Repeat("a", 40), strings.Repeat("b", 64)
	pin := revision + ":" + artifact
	release := releaseIdentity{"control-v6.0.38", revision, artifact}
	if releaseAllowedForEnrollment(release, pin, "", "") ||
		releaseAllowedForEnrollment(release, pin, "0", pin) ||
		releaseAllowedForEnrollment(release, pin, "1", "") ||
		releaseAllowedForEnrollment(release, pin, "1", revision+":"+strings.Repeat("c", 64)) {
		t.Fatal("unqualified candidate accepted outside exact enabled rehearsal")
	}
	if !releaseAllowedForEnrollment(release, "", "1", pin) {
		t.Fatal("reviewed exact candidate must be testable in isolated WAL rehearsal")
	}
}

func TestRetirementPossessionCandidateFixtureOnly(t *testing.T) {
	release := releaseIdentity{"control-v6.0.39", strings.Repeat("a", 40), strings.Repeat("b", 64)}
	pin := release.SourceRevision + ":" + release.ArtifactSHA256
	production := &gateway{}
	if production.enrollmentReleaseAllowed(release, pin, "1", pin) {
		t.Fatal("production and existing WAL candidate allowlists must reject 6.0.39")
	}
	fixture := &gateway{fixtureEnrollmentCandidate: &release}
	if fixture.enrollmentReleaseAllowed(release, pin, "0", pin) ||
		fixture.enrollmentReleaseAllowed(release, pin, "1", "") ||
		fixture.enrollmentReleaseAllowed(release, pin, "1", release.SourceRevision+":"+strings.Repeat("c", 64)) {
		t.Fatal("fixture must require exact enabled rehearsal pin")
	}
	other := release
	other.SourceRevision = strings.Repeat("d", 40)
	if fixture.enrollmentReleaseAllowed(other, "", "1", other.SourceRevision+":"+other.ArtifactSHA256) {
		t.Fatal("fixture must reject a different self-consistent artifact")
	}
	if !fixture.enrollmentReleaseAllowed(release, "", "1", pin) {
		t.Fatal("fixture must allow exact reviewed candidate in the lab")
	}
}
