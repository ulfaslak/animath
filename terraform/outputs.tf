output "server_ip" {
  description = "Public IPv4 address of the server: the domain's A record, and the VPS_HOST secret"
  value       = hcloud_server.mathgame.ipv4_address
}

output "server_ipv6" {
  description = "Public IPv6 address of the server. Not for DNS: the domain has an A record only (.claude/commands/redeploy.md)"
  value       = hcloud_server.mathgame.ipv6_address
}

output "server_status" {
  description = "Server status"
  value       = hcloud_server.mathgame.status
}
