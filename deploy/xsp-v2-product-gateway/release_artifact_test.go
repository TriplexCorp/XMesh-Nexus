package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestReadReleaseChunkRejectsUnsafeArtifactSources(t *testing.T) {
	root := t.TempDir()
	data := bytes.Repeat([]byte("x"), releaseChunkBytes+13)
	digest := fmt.Sprintf("%x", sha256.Sum256(data))
	path := filepath.Join(root, digest+".bin")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	first, total, err := readReleaseChunk(root, digest, 0)
	if err != nil || total != int64(len(data)) || !bytes.Equal(first, data[:releaseChunkBytes]) {
		t.Fatalf("first chunk rejected: %v", err)
	}
	last, total, err := readReleaseChunk(root, digest, releaseChunkBytes)
	if err != nil || total != int64(len(data)) || !bytes.Equal(last, data[releaseChunkBytes:]) {
		t.Fatalf("last chunk rejected: %v", err)
	}
	for _, offset := range []int64{-1, 1, 2 * releaseChunkBytes, maxReleaseArtifactBytes} {
		if _, _, err := readReleaseChunk(root, digest, offset); err == nil {
			t.Fatalf("invalid offset accepted: %d", offset)
		}
	}
	if _, _, err := readReleaseChunk(root, "../unapproved", 0); err == nil {
		t.Fatal("path traversal accepted")
	}
	if err := os.Chmod(path, 0666); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("writable artifact accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "hardlink")
	if err := os.Link(path, link); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("multiply linked artifact accepted")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(path, link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(link, path); err != nil {
		t.Fatal(err)
	}
	if _, _, err := readReleaseChunk(root, digest, 0); err == nil {
		t.Fatal("symlink artifact accepted")
	}
}
