# XMesh Nexus

**XMesh Nexus** is the web-based **control panel** for managing XMesh / Xray VPN infrastructure.

> This repository contains the panel UI only — not an XMesh node, node agent, or server-side daemon.

## Entry point

- `index.html` — main control-panel interface

## Current implementation status

The current HTML is a **frontend prototype**. It stores settings in browser `localStorage` and uses generated demo data. CPU, RAM, speed, node status, and user records shown in the interface are not live telemetry.

The panel is **not yet connected** to Xray, Marzban, or a production backend API. Node-side services and the control-plane backend are separate components and are not implemented by this frontend repository.

Do not use the current prototype as a production control plane until backend integration, authentication, authorization, and server-side validation are implemented.

## Product identity

- **Product:** XMesh Nexus
- **Role:** Infrastructure Control Panel
- **Descriptor:** Infrastructure Control Platform
- **Tagline:** One platform. Every node. Total control.
