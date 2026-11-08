<#
.SYNOPSIS
  Signs tab-scrobbler with Mozilla for private (unlisted) use.

.DESCRIPTION
  Reads the Mozilla add-ons API credentials from a DPAPI-encrypted file that
  only the current Windows account can decrypt, hands them to web-ext for the
  duration of the signing command only, then clears them.

  One-time setup (username = JWT issuer, password = JWT secret, from
  https://addons.mozilla.org/developers/addon/api/key/):

    Get-Credential -Message "Mozilla add-ons API" | Export-Clixml "$env:USERPROFILE\.web-ext-amo.xml"

  Remember to bump "version" in tab-scrobbler/manifest.json first; Mozilla
  will not sign the same version twice. The signed .xpi lands in
  tab-scrobbler/web-ext-artifacts/.
#>
[CmdletBinding()]
param(
    [string]$CredentialFile = "$env:USERPROFILE\.web-ext-amo.xml"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $CredentialFile)) {
    throw "No credential file at $CredentialFile. Run the one-time setup in the header of this script."
}

$cred = Import-Clixml $CredentialFile
$manifest = Get-Content (Join-Path $PSScriptRoot 'tab-scrobbler\manifest.json') -Raw | ConvertFrom-Json
Write-Host "Signing Tab Scrobbler $($manifest.version) as unlisted..."

$env:WEB_EXT_API_KEY = $cred.UserName
$env:WEB_EXT_API_SECRET = $cred.GetNetworkCredential().Password
try {
    Push-Location (Join-Path $PSScriptRoot 'tab-scrobbler')
    npx --yes web-ext sign --channel=unlisted
    if ($LASTEXITCODE -ne 0) { throw "web-ext sign exited with code $LASTEXITCODE" }
}
finally {
    Pop-Location
    Remove-Item Env:WEB_EXT_API_KEY, Env:WEB_EXT_API_SECRET -ErrorAction SilentlyContinue
}
