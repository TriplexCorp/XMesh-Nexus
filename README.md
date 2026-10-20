# XMesh — Lumen Panel

The repository contains the latest supplied panel UI in both `index.html` (homepage entry point) and `lumen-panel-updated.html` (original filename).

## Current implementation status

This uploaded HTML is a **frontend prototype**. Its current data layer uses browser `localStorage` and generated demo data. The node CPU/RAM/speed values and user records are not live server telemetry, and the panel is not yet connected to Xray, Marzban, or a production backend API.

Do not expose this static demo as a production control panel or rely on its displayed data for operational decisions.

## Preview

Open `index.html` locally, or configure GitHub Pages to publish this static page.

## Production integration

A production deployment still needs a backend API, authentication and authorization, secure secret handling, persistent server-side storage, and real monitoring/control integrations.
