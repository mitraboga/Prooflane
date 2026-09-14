param(
  [ValidateSet('Initialize','Addresses','Deploy','CopyOwner','CopyAgent')]
  [string]$Action = 'Addresses'
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This helper uses Windows user-bound encryption. On other systems use your password manager and process environment.' }
$projectDirectory = Split-Path -Parent $PSScriptRoot
$keyDirectory = Join-Path $projectDirectory 'data'
$keyFile = Join-Path $keyDirectory 'testnet-keys.encrypted.json'
Set-Location -LiteralPath $projectDirectory

if ($Action -eq 'Initialize') {
  if (Test-Path -LiteralPath $keyFile) { throw 'An encrypted key file already exists. Use Addresses; keys are never replaced automatically.' }
  $walletJson = & node --input-type=module -e 'import { Wallet } from "ethers"; const owner=Wallet.createRandom(),agent=Wallet.createRandom(); process.stdout.write(JSON.stringify({owner:{address:owner.address,key:owner.privateKey},agent:{address:agent.address,key:agent.privateKey}}));'
  if ($LASTEXITCODE -ne 0) { throw 'Wallet generation failed.' }
  $wallets = $walletJson | ConvertFrom-Json
  $encrypted = @{}
  foreach ($role in @('owner','agent')) {
    $secureKey = ConvertTo-SecureString -String $wallets.$role.key -AsPlainText -Force
    $encrypted[$role] = @{ address = $wallets.$role.address; encryptedKey = (ConvertFrom-SecureString -SecureString $secureKey) }
    $secureKey.Dispose()
  }
  New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
  $encrypted | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $keyFile -Encoding utf8
  $walletJson = $null; $wallets = $null
}

if (-not (Test-Path -LiteralPath $keyFile)) { throw 'Run with -Action Initialize first.' }
$stored = Get-Content -LiteralPath $keyFile -Raw | ConvertFrom-Json
if ($Action -in @('Initialize','Addresses')) {
  [pscustomobject]@{ Network='Base Sepolia'; Owner=$stored.owner.address; Agent=$stored.agent.address; Storage='Windows user-encrypted, ignored by Git' } | ConvertTo-Json
  return
}
function Read-Key([string]$Role) {
  $secure = ConvertTo-SecureString -String $stored.$Role.encryptedKey
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
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
