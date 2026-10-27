// Command generate-xsp-v2-mldsa-test-certs creates disposable C2-A client
// certificate fixtures with Go 1.27 standard-library ML-DSA/X.509 support.
// The generated keys are public-test material and must never be enrolled.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/mldsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"flag"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"time"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func writeFile(dir, name string, mode os.FileMode, data []byte) {
	must(os.WriteFile(filepath.Join(dir, name), data, mode))
}

func privatePEM(key any) []byte {
	der, err := x509.MarshalPKCS8PrivateKey(key)
	must(err)
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func certPEM(der []byte) []byte {
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
}

func serial(value int64) *big.Int {
	return big.NewInt(value)
}

func main() {
	out := flag.String("out", "", "output directory")
	flag.Parse()
	if *out == "" {
		panic("-out is required")
	}
	must(os.MkdirAll(*out, 0o700))
	now := time.Now()

	caKey, err := mldsa.GenerateKey(mldsa.MLDSA65())
	must(err)
	caTemplate := &x509.Certificate{
		SerialNumber:          serial(1001),
		Subject:               pkix.Name{CommonName: "XSP-v2 disposable Go ML-DSA client CA"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, caKey.Public(), caKey)
	must(err)
	caCert, err := x509.ParseCertificate(caDER)
	must(err)
	writeFile(*out, "client-ca.pem", 0o644, certPEM(caDER))

	makeClient := func(name string, serialNumber int64) ([]byte, any) {
		key, err := mldsa.GenerateKey(mldsa.MLDSA65())
		must(err)
		template := &x509.Certificate{
			SerialNumber:          serial(serialNumber),
			Subject:               pkix.Name{CommonName: name},
			NotBefore:             now.Add(-time.Minute),
			NotAfter:              now.Add(time.Hour),
			KeyUsage:              x509.KeyUsageDigitalSignature,
			ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
			BasicConstraintsValid: true,
		}
		der, err := x509.CreateCertificate(rand.Reader, template, caCert, key.Public(), caKey)
		must(err)
		return der, key
	}

	clientDER, clientKey := makeClient("untrusted-text-node-id", 2001)
	writeFile(*out, "client.pem", 0o644, certPEM(clientDER))
	writeFile(*out, "client-key.pem", 0o600, privatePEM(clientKey))

	otherDER, otherKey := makeClient("another-node", 2002)
	writeFile(*out, "other-client.pem", 0o644, certPEM(otherDER))
	writeFile(*out, "other-client-key.pem", 0o600, privatePEM(otherKey))

	classicalKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	must(err)
	classicalTemplate := &x509.Certificate{
		SerialNumber:          serial(2003),
		Subject:               pkix.Name{CommonName: "classical-client"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	classicalDER, err := x509.CreateCertificate(rand.Reader, classicalTemplate, caCert, classicalKey.Public(), caKey)
	must(err)
	writeFile(*out, "classical-client.pem", 0o644, certPEM(classicalDER))
	writeFile(*out, "classical-client-key.pem", 0o600, privatePEM(classicalKey))

	clientCert, err := x509.ParseCertificate(clientDER)
	must(err)
	spkiDER, err := x509.MarshalPKIXPublicKey(clientCert.PublicKey)
	must(err)
	digest := sha256.Sum256(spkiDER)
	writeFile(*out, "client-spki.sha256", 0o644, []byte(hex.EncodeToString(digest[:])+"\n"))

	fmt.Println("generated disposable Go 1.27 ML-DSA-65 client certificate fixtures")
}
