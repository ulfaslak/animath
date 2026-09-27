# The game's own server: a Hetzner Cloud VPS, the same as lawcel's, and not
# lawcel's (whose nginx owns ports 80 and 443 and is reset from lawcel's repo
# on every lawcel deploy). Run from the primary clone, where the state stays:
#
#   cd terraform && terraform init && terraform apply
#
# with the API token in terraform/terraform.tfvars (gitignored; never print
# it). After it: .claude/commands/redeploy.md.

terraform {
  required_version = ">= 1.5"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.49"
    }
  }
}

provider "hcloud" {
  token = var.hcloud_token
}

resource "hcloud_ssh_key" "deploy" {
  name       = "mathgame-deploy"
  public_key = file(pathexpand(var.ssh_public_key_path))
}

resource "hcloud_firewall" "mathgame" {
  name = "mathgame"

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  # Port 80 must stay open: Let's Encrypt's HTTP-01 challenge comes in on it.
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "80"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "443"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }
}

resource "hcloud_server" "mathgame" {
  name        = "mathgame-prod"
  server_type = var.server_type
  location    = var.location
  image       = "ubuntu-24.04"
  ssh_keys    = [hcloud_ssh_key.deploy.id]

  # Hetzner Cloud Backups: nightly whole-machine images, 7 rolling slots, at 20%
  # of the server price. The only layer that recovers the MACHINE rather than
  # the database (the backup service in docker-compose.prod.yml dumps the data
  # every 6 hours).
  #
  # REQUIRED, not cosmetic. The provider defaults `backups` to false, so with
  # this line gone a `terraform apply` plans backups back OFF, and nothing would
  # report it (lawcel's main.tf).
  backups = true

  firewall_ids = [hcloud_firewall.mathgame.id]

  user_data = templatefile("${path.module}/cloud-init.yml", {
    deploy_public_key = file(pathexpand(var.ssh_public_key_path))
  })
}
