# Infrastructure

This directory contains reference deployment configurations for both self-hosted and managed cloud modes.

## Self-hosted

- Compose stack: `infra/self-hosted/docker-compose.yml`
- Runs control-plane, runner, and web with guarded execution defaults enabled.

## Cloud

- Kubernetes manifests: `infra/cloud/k8s`
- Terraform bootstrap placeholder: `infra/cloud/terraform/main.tf`
- Uses the same service split as self-hosted for compatibility parity.
