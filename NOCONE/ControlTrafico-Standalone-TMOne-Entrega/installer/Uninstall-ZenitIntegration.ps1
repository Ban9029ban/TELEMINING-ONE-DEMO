param([string]$ZenitRoot = "")
$ErrorActionPreference='Stop';$moduleRoot=Split-Path -Parent $PSScriptRoot
if(-not $ZenitRoot){$candidate=Get-ChildItem (Split-Path -Parent $moduleRoot) -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue|Where-Object{Test-Path (Join-Path $_.FullName 'web_front\.control-trafico-barreras-installed.json')}|Select-Object -First 1;if($candidate){$ZenitRoot=$candidate.FullName}}
$front=Join-Path $ZenitRoot 'web_front';$marker=Join-Path $front '.control-trafico-barreras-installed.json'
if(-not(Test-Path $marker)){Write-Host 'No hay integración instalada.';exit 0}
$info=Get-Content $marker -Raw|ConvertFrom-Json;$backup=$info.backup
foreach($file in @('src\components\Sidebar.jsx','src\routes\General.jsx','src\utils\accessControl.js','src\pages\ControlTraficoBarreras\index.jsx')){$saved=Join-Path $backup $file;$target=Join-Path $front $file;if(Test-Path $saved){Copy-Item $saved $target -Force}elseif(Test-Path $target){Remove-Item $target -Force}}
Remove-Item $marker -Force;Write-Host 'Integración revertida. El módulo y sus datos no se modificaron.'
