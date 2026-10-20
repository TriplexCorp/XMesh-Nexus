# XMesh Nexus

**XMesh Nexus** is a modern control panel interface for managing Xray-powered VPN infrastructure.

> This repository contains the panel frontend only — not an Xray node, node agent, or server-side daemon.

## Frontend structure

- `index.html` — application shell and entry point
- `styles.css` — visual system, themes, responsive layouts, and node-grid density
- `app.js` — interface behaviour, local prototype data, and client-side interactions

## Design direction

The default interface uses an **Obsidian / Champagne** visual language: graphite surfaces, restrained warm-metal accents, precise typography, subtle depth, and a responsive infrastructure grid. The appearance panel still lets users customise theme, accent, density, surfaces, and motion.

## Current implementation status

This repository is currently a **frontend prototype**. Settings and prototype state are stored in the browser, and the panel is not yet connected to Xray, Marzban, or a production backend API.

CPU, RAM, throughput, node health, and other live operational telemetry require a real monitoring/backend integration. Do not treat the current UI as a production control plane until authentication, authorisation, backend integration, and server-side validation are implemented.

## Product identity

- **Product:** XMesh Nexus
- **Role:** Xray VPN Infrastructure Control Panel
- **Descriptor:** Infrastructure Control Platform
- **Tagline:** One platform. Every node. Total control.
