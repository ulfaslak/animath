variable "hcloud_token" {
  description = "Hetzner Cloud API token (Read & Write), from the project's Security > API tokens"
  type        = string
  sensitive   = true
}

variable "ssh_public_key_path" {
  description = "The deploy key the deploy user logs in with"
  type        = string
  default     = "~/.ssh/mathgame_deploy.pub"
}

variable "server_type" {
  description = "Hetzner server type (e.g. cx23, cx33)"
  type        = string
  default     = "cx23"
}

variable "location" {
  description = "Hetzner datacenter location"
  type        = string
  default     = "nbg1"
}
