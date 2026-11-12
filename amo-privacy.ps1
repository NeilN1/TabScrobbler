<#
.SYNOPSIS
  Uploads PRIVACY.md as the add-on's privacy policy on addons.mozilla.org.

.DESCRIPTION
  The AMO submission API has no privacy-policy field; it is set through the
  separate EULA/privacy endpoint. Uses the same DPAPI-encrypted credentials as
  sign.ps1 (see its header) to mint a short-lived JWT, which never leaves this
  process. Run after the first listed submission, and again whenever
  PRIVACY.md changes.
#>
[CmdletBinding()]
param(
    [string]$CredentialFile = "$env:USERPROFILE\.web-ext-amo.xml",
    [string]$AddonId = 'tab-scrobbler@localhost'
)

$ErrorActionPreference = 'Stop'
$cred = Import-Clixml $CredentialFile
$secretBytes = [Text.Encoding]::UTF8.GetBytes($cred.GetNetworkCredential().Password)

function B64Url([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$header = B64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
$claims = @{ iss = $cred.UserName; jti = [guid]::NewGuid().ToString(); iat = $now; exp = $now + 60 }
$payload = B64Url ([Text.Encoding]::UTF8.GetBytes(($claims | ConvertTo-Json -Compress)))
$hmac = [System.Security.Cryptography.HMACSHA256]::new($secretBytes)
$signature = B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$header.$payload")))
$jwt = "$header.$payload.$signature"

$policy = Get-Content (Join-Path $PSScriptRoot 'PRIVACY.md') -Raw
$body = @{ privacy_policy = @{ 'en-US' = $policy } } | ConvertTo-Json -Depth 4
$uri = "https://addons.mozilla.org/api/v5/addons/addon/$AddonId/eula_policy/"

$result = Invoke-RestMethod -Method Patch -Uri $uri -Headers @{ Authorization = "JWT $jwt" } `
    -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
$length = ($result.privacy_policy.'en-US' | Measure-Object -Character).Characters
Write-Host "Privacy policy set ($length characters)."
