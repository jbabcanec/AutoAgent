# Infrastructure

This directory contains reference deployment configurations for control-plane and runner services.

## Self-hosted

- Compose stack: `infra/self-hosted/docker-compose.yml`
- Runs control-plane and runner with guarded execution defaults enabled.

## Cloud

- Kubernetes manifests: `infra/cloud/k8s`
- Terraform bootstrap placeholder: `infra/cloud/terraform/main.tf`
- Desktop UI is distributed as an Electron app, not a cloud web service.
