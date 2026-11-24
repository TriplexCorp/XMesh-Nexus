package main

import (
	"strconv"
	"strings"
)

// The gateway authorizes only the configured release manifest, and only
// when its canonical v6 version is strictly newer than the original Agent.
func forwardProductVersion(current, target string) bool {
	parse := func(value string) ([2]uint64, bool) {
		var out [2]uint64
		const prefix = "control-v6."
		if !strings.HasPrefix(value, prefix) {
			return out, false
		}
		parts := strings.Split(strings.TrimPrefix(value, prefix), ".")
		if len(parts) != 2 {
			return out, false
		}
		for i, part := range parts {
			if len(part) == 0 || (len(part) > 1 && part[0] == '0') {
				return out, false
			}
			for _, ch := range part {
				if ch < '0' || ch > '9' {
					return out, false
				}
			}
			number, err := strconv.ParseUint(part, 10, 32)
			if err != nil {
				return out, false
			}
			out[i] = number
		}
		return out, true
	}
	from, fromOK := parse(current)
	to, toOK := parse(target)
	return fromOK && toOK && (to[0] > from[0] || (to[0] == from[0] && to[1] > from[1]))
}

func validForwardProductRelease(current, target releaseIdentity) bool {
	return forwardProductVersion(current.Version, target.Version) &&
		len(current.SourceRevision) == 40 && isLowerHex(current.SourceRevision) &&
		len(target.SourceRevision) == 40 && isLowerHex(target.SourceRevision) &&
		len(current.ArtifactSHA256) == 64 && isLowerHex(current.ArtifactSHA256) &&
		len(target.ArtifactSHA256) == 64 && isLowerHex(target.ArtifactSHA256) &&
		current.SourceRevision != target.SourceRevision && current.ArtifactSHA256 != target.ArtifactSHA256
}
