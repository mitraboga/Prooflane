param(
  [ValidateSet('Initialize','InitializePortable','Verify','Addresses','Deploy','CopyOwner','CopyAgent')]
  [string]$Action = 'Addresses'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This PowerShell wrapper is for Windows. The portable keystores can also be unlocked with ethers on other systems.' }
$projectDirectory = Split-Path -Parent $PSScriptRoot
$keyDirectory = Join-Path $projectDirectory 'data'
$keyFile = Join-Path $keyDirectory 'testnet-keys.encrypted.json'
$portableFile = Join-Path $keyDirectory 'testnet-keys.portable.json'
Set-Location -LiteralPath $projectDirectory

function Read-PasswordText([string]$PromptText) {
  $secure = Read-Host -Prompt $PromptText -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}
function Invoke-Portable([string]$Operation, [string]$PasswordText, [string]$ConfirmationText = '') {
  $previousEncoding = $OutputEncoding
  try {
    # PowerShell 5 otherwise pipes non-ASCII passwords using an ASCII encoding.
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $payload = @{ password = $PasswordText; confirmation = $ConfirmationText } | ConvertTo-Json -Compress
    $result = $payload | & node scripts/testnet-vault.mjs $Operation
    if ($LASTEXITCODE -ne 0) { throw 'Portable wallet operation failed. Review the message above.' }
    return $result
  } finally { $payload = $null; $OutputEncoding = $previousEncoding }
}

if ($Action -in @('Initialize','InitializePortable')) {
  if (Test-Path -LiteralPath $portableFile) { throw 'A portable wallet already exists. Use Verify or Addresses; it will not be replaced.' }
  if ($Action -eq 'Initialize' -and (Test-Path -LiteralPath $keyFile)) { throw 'A legacy wallet exists. Use Verify to check it. InitializePortable explicitly creates a new wallet while preserving the legacy file.' }
  $password = Read-PasswordText 'Create a wallet password/passphrase (at least 16 characters; save it privately)'
  $confirmation = Read-PasswordText 'Confirm wallet password'
  try {
    $null = Invoke-Portable 'InitializePortable' $password $confirmation
    # Reload/decrypt/sign in a separate Node process before suggesting funding.
    $verified = Invoke-Portable 'Verify' $password | ConvertFrom-Json
    Write-Output 'Portable wallets saved. Reload, decryption and signing checks passed for both keys.'
    Write-Output ('Owner (fund this NEW address): ' + $verified.owner)
    Write-Output ('Agent (no gas required): ' + $verified.agent)
    Write-Output 'Original legacy file preserved. Do not fund an earlier address.'
  } finally { $password = $null; $confirmation = $null }
  return
}

if (Test-Path -LiteralPath $portableFile) {
  if ($Action -eq 'Addresses') { & node scripts/testnet-vault.mjs Addresses; return }
  $password = Read-PasswordText 'Wallet password'
  $previousKey = $env:DEPLOYER_PRIVATE_KEY
  try {
    if ($Action -eq 'Verify') { Invoke-Portable 'Verify' $password; return }
    if ($Action -in @('CopyOwner','CopyAgent')) {
      $operation = if ($Action -eq 'CopyOwner') { 'ReadOwner' } else { 'ReadAgent' }
      $privateKey = Invoke-Portable $operation $password
      Set-Clipboard -Value $privateKey
      Write-Output 'Key copied for direct paste into Render secrets. Clear the clipboard afterward.'
      return
    }
    $env:DEPLOYER_PRIVATE_KEY = Invoke-Portable 'ReadOwner' $password
    & node scripts/deploy.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Deployment did not complete. Review the non-secret status above.' }
  } finally {
    $password = $null; $privateKey = $null
    if ($null -eq $previousKey) { Remove-Item Env:DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue }
    else { $env:DEPLOYER_PRIVATE_KEY = $previousKey }
  }
  return
}

if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Run with -Action Initialize first.' }
$stored = Get-Content -LiteralPath $keyFile -Raw | ConvertFrom-Json
if ($Action -in @('Initialize','Addresses')) {
  [pscustomobject]@{ Network='Base Sepolia'; Owner=$stored.owner.address; Agent=$stored.agent.address; Storage='Windows user-encrypted, ignored by Git' } | ConvertTo-Json
  return
}
function Read-Key([string]$Role) {
  try { $secure = ConvertTo-SecureString -String $stored.$Role.encryptedKey }
  catch { throw 'Windows cannot unlock this legacy wallet in this context. InitializePortable creates a new password-protected wallet and preserves the old file; the new owner needs its own faucet funding.' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
}
if ($Action -eq 'Verify') {
  $null = Read-Key 'owner'; $null = Read-Key 'agent'
  Write-Output 'Both legacy keys decrypted successfully in this Windows context.'
  return
}
if ($Action -in @('CopyOwner','CopyAgent')) {
  $role = if ($Action -eq 'CopyOwner') { 'owner' } else { 'agent' }
  Set-Clipboard -Value (Read-Key $role)
  Write-Output 'Key copied for pasting directly into the matching Render secret field. Clear the clipboard after pasting.'
  return
}
if ($Action -eq 'Deploy') {
  $previousKey = $env:DEPLOYER_PRIVATE_KEY
  try {
    $env:DEPLOYER_PRIVATE_KEY = Read-Key 'owner'
    & node scripts/deploy.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Deployment did not complete. Review the non-secret status above.' }
  } finally {
    if ($null -eq $previousKey) { Remove-Item Env:DEPLOYER_PRIVATE_KEY -ErrorAction SilentlyContinue }
    else { $env:DEPLOYER_PRIVATE_KEY = $previousKey }
  }
}
