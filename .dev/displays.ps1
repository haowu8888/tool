# Writes the displays to .dev/displays.txt: every display device with its
# state flags and current mode, the monitors on it, and how long the user
# has been idle. Run through the interactive scheduled task ToolboxDisplays.
Add-Type @"
using System; using System.Runtime.InteropServices;
public class D {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  public struct LASTINPUTINFO { public int cbSize; public uint dwTime; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplayDevices(string dev, int i, ref DISPLAY_DEVICE dd, int flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool EnumDisplaySettingsEx(string dev, int mode, ref DEVMODE dm, int flags);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
}
"@
$out = @()
for ($i = 0; ; $i++) {
  $dd = New-Object D+DISPLAY_DEVICE; $dd.cb = [Runtime.InteropServices.Marshal]::SizeOf($dd)
  if (-not [D]::EnumDisplayDevices([NullString]::Value, $i, [ref]$dd, 0)) { break }
  $dm = New-Object D+DEVMODE; $dm.dmSize = [Runtime.InteropServices.Marshal]::SizeOf($dm)
  $mode = if ([D]::EnumDisplaySettingsEx($dd.DeviceName, -1, [ref]$dm, 0)) { "$($dm.dmPelsWidth)x$($dm.dmPelsHeight)@$($dm.dmPositionX),$($dm.dmPositionY)" } else { "-" }
  $out += "$($dd.DeviceName) flags=0x$('{0:x}' -f $dd.StateFlags) mode=$mode [$($dd.DeviceString)]"
  for ($j = 0; ; $j++) {
    $md = New-Object D+DISPLAY_DEVICE; $md.cb = $dd.cb
    if (-not [D]::EnumDisplayDevices($dd.DeviceName, $j, [ref]$md, 0)) { break }
    $out += "    monitor flags=0x$('{0:x}' -f $md.StateFlags) [$($md.DeviceString)] $($md.DeviceID)"
  }
}
$li = New-Object D+LASTINPUTINFO; $li.cbSize = 8; [void][D]::GetLastInputInfo([ref]$li)
$out += "idle=$([int](([Environment]::TickCount - $li.dwTime) / 1000))s"
$out | Out-File -Encoding UTF8 "$PSScriptRoot\displays.txt"
