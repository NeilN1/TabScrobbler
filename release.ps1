#Requires -Version 7.0
<#
.SYNOPSIS
  Releases one version to both addons.mozilla.org and GitHub, so the version
  numbers on the two never drift apart.

.DESCRIPTION
  In order:
    1. checks the repository (on main, clean, up to date, tests and lint pass);
    2. sets the new version in tab-scrobbler/manifest.json;
    3. submits it to the public listing on addons.mozilla.org, with the listing
       text from amo-metadata.json and the given release notes, and uploads
       PRIVACY.md as the privacy policy;
    4. commits the version bump, tags it vX.Y.Z and pushes both;
    5. creates the matching GitHub release.

  Nothing is committed or pushed unless Mozilla accepts the upload. The public
  listing only changes once Mozilla's review approves the version, so it can
  trail the GitHub release by hours or days.

  Uses the same encrypted Mozilla credentials as sign.ps1 (see its header) and
  the GitHub CLI's existing sign-in.

  For testing a change, do not release: load tab-scrobbler/manifest.json from
  about:debugging instead, which needs no version number.

.EXAMPLE
  .\release.ps1 -Notes "The toolbar icon is grey unless a track is being scrobbled."

.EXAMPLE
  .\release.ps1 -Version 1.1.0 -Notes "..." -DryRun
#>
[CmdletBinding()]
param(
    # What changed, in a sentence or two. Shown on the Mozilla listing and the GitHub release.
    [Parameter(Mandatory)]
    [string]$Notes,
    # Defaults to the current version with its last number increased by one.
    [string]$Version = '',
    # Run the checks and show what would happen, changing nothing.
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$listingUrl = 'https://addons.mozilla.org/en-US/firefox/addon/055f5b33a2434c7ea433/'
$reviewUrl = 'https://addons.mozilla.org/en-US/developers/addon/055f5b33a2434c7ea433/versions'
$manifestPath = Join-Path $PSScriptRoot 'tab-scrobbler\manifest.json'
$versionPattern = [regex]'("version"\s*:\s*")(\d+\.\d+\.\d+)(")'

$manifestText = [IO.File]::ReadAllText($manifestPath)
$match = $versionPattern.Match($manifestText)
if (-not $match.Success) { throw "No version found in $manifestPath" }
$current = [version]$match.Groups[2].Value
if (-not $Version) { $Version = "$($current.Major).$($current.Minor).$($current.Build + 1)" }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, got '$Version'" }
$tag = "v$Version"

# ---- checks ---------------------------------------------------------------

$problems = [System.Collections.Generic.List[string]]::new()

if ([version]$Version -le $current) { $problems.Add("Version $Version is not higher than the current $current.") }
if ((git rev-parse --abbrev-ref HEAD) -ne 'main') { $problems.Add('Not on the main branch.') }
if (git status --porcelain) { $problems.Add('The working tree has uncommitted changes.') }

git fetch --quiet origin
if ($LASTEXITCODE -ne 0) { $problems.Add('Could not reach GitHub (git fetch failed).') }
elseif ([int](git rev-list --count 'HEAD..origin/main') -gt 0) { $problems.Add('main is behind origin/main; pull first.') }

if ((git tag --list $tag) -or (git ls-remote --tags origin "refs/tags/$tag")) { $problems.Add("Tag $tag already exists.") }
if ((Get-Content (Join-Path $PSScriptRoot 'tab-scrobbler\config.js') -Raw) -match 'PASTE_') {
    $problems.Add('tab-scrobbler/config.js still has placeholder Last.fm credentials.')
}
if (-not (Test-Path "$env:USERPROFILE\.web-ext-amo.xml")) { $problems.Add('No Mozilla credential file; see the header of sign.ps1.') }

gh auth status *> $null
if ($LASTEXITCODE -ne 0) { $problems.Add('The GitHub CLI is not signed in (gh auth login).') }

$testOutput = node tests/run.js
if ($LASTEXITCODE -ne 0) { $problems.Add("Tests failed: $($testOutput | Where-Object { $_ -match '^FAIL' } | Select-Object -First 3)") }

Push-Location (Join-Path $PSScriptRoot 'tab-scrobbler')
try { $lintOutput = npx --yes web-ext@10.8.0 lint --output text 2>&1; $lintExit = $LASTEXITCODE }
finally { Pop-Location }
if ($lintExit -ne 0) { $problems.Add("web-ext lint reported errors: $($lintOutput | Where-Object { $_ -match '^errors' })") }

Write-Host "Release $current -> $Version (tag $tag)"
Write-Host "Notes: $Notes"
if ($problems.Count) {
    Write-Host "`nCannot release yet:" -ForegroundColor Yellow
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    if (-not $DryRun) { throw 'Fix the problems above and run again.' }
}
if ($DryRun) {
    Write-Host "`nDry run. A real run would:"
    Write-Host "  1. set the version to $Version in tab-scrobbler/manifest.json"
    Write-Host "  2. submit $Version to the public listing and upload PRIVACY.md"
    Write-Host "  3. commit 'Release $Version', tag $tag, push main and the tag"
    Write-Host "  4. create the GitHub release $tag"
    return
}

# ---- Mozilla --------------------------------------------------------------

$bumped = $versionPattern.Replace($manifestText, { param($m) $m.Groups[1].Value + $Version + $m.Groups[3].Value }, 1)
[IO.File]::WriteAllText($manifestPath, $bumped)

$metadata = Get-Content (Join-Path $PSScriptRoot 'amo-metadata.json') -Raw | ConvertFrom-Json
$metadata.version.release_notes.'en-US' = $Notes
$metadataFile = Join-Path ([IO.Path]::GetTempPath()) "tab-scrobbler-amo-$Version.json"
$metadata | ConvertTo-Json -Depth 10 | Set-Content $metadataFile -Encoding utf8NoBOM

try {
    & (Join-Path $PSScriptRoot 'sign.ps1') -Channel listed -Metadata $metadataFile
}
catch {
    # Mozilla did not take it, so leave the repository exactly as it was.
    [IO.File]::WriteAllText($manifestPath, $manifestText)
    throw "Mozilla rejected the submission; nothing was committed. $_"
}
finally {
    Remove-Item $metadataFile -ErrorAction SilentlyContinue
}

try { & (Join-Path $PSScriptRoot 'amo-privacy.ps1') }
catch { Write-Warning "The privacy policy was not updated ($_). Run .\amo-privacy.ps1 later." }

# ---- GitHub ---------------------------------------------------------------
# From here on Mozilla already has this version, so a failure must not be
# retried with the same number: finish the remaining steps by hand.

function Step([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Mozilla has accepted $Version, but '$What' failed. Do not re-run the release; finish the remaining Git and GitHub steps by hand."
    }
}

Step 'git commit' { git commit --quiet -m "Release $Version" -- tab-scrobbler/manifest.json }
Step 'git tag' { git tag -a $tag -m "Tab Scrobbler $Version" }
Step 'git push' { git push --quiet origin main $tag }

$notesFile = Join-Path ([IO.Path]::GetTempPath()) "tab-scrobbler-notes-$Version.md"
@"
$Notes

Install or update from [addons.mozilla.org]($listingUrl). Firefox updates installed copies automatically once Mozilla's review approves this version, which can take a few days.
"@ | Set-Content $notesFile -Encoding utf8NoBOM
try { Step 'gh release create' { gh release create $tag --verify-tag --title "Tab Scrobbler $Version" --notes-file $notesFile } }
finally { Remove-Item $notesFile -ErrorAction SilentlyContinue }

Write-Host "`nReleased $Version." -ForegroundColor Green
Write-Host "  Mozilla review status: $reviewUrl"
Write-Host "  GitHub release:        https://github.com/NeilN1/TabScrobbler/releases/tag/$tag"
