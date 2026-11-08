// Starstation pad helper (SPEC-v2 A): runs next to Starstation while a game is running.
//  - watches the PS / Home button of every controller, also while the emulator has focus:
//    XInput pads (incl. PlayStation pads through SCP/DS4Windows) via XInputGetStateEx (guide button),
//    DualShock 4 / DualSense directly over HID
//  - closes, focuses and sends hotkeys to the emulator window
// Talks over stdin/stdout, one line per message:
//   out: "ready", "home <pad>", "pads <id,id,...>", "fg <pid>", "ok <cmd>", "err <cmd> <text>"
//   in:  "close <pid>", "focus <pid>", "keys <pid> <combo>" (e.g. SHIFT+F1), "mute <pid> [0|1]", "fg", "quit"
// Built with the C# compiler that ships with Windows (scripts/build-native.mjs). C# 5: no newer syntax here.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class PadHelper
{
    static readonly object outLock = new object();
    static void Say(string line)
    {
        lock (outLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }

    // ---------------- XInput ----------------
    [StructLayout(LayoutKind.Sequential)]
    struct XGamepad { public ushort wButtons; public byte bLeftTrigger; public byte bRightTrigger; public short sThumbLX; public short sThumbLY; public short sThumbRX; public short sThumbRY; }
    [StructLayout(LayoutKind.Sequential)]
    struct XState { public uint dwPacketNumber; public XGamepad Gamepad; }
    // ordinal 100 = XInputGetStateEx: like XInputGetState, but it also reports the guide (PS / Xbox) button
    [DllImport("xinput1_4.dll", EntryPoint = "#100")]
    static extern uint XInputGetStateEx(uint index, ref XState state);
    const ushort GUIDE = 0x0400;

    // ---------------- HID (DualShock 4 / DualSense) ----------------
    [StructLayout(LayoutKind.Sequential)]
    struct SP_DEVICE_INTERFACE_DATA { public int cbSize; public Guid InterfaceClassGuid; public int Flags; public IntPtr Reserved; }
    [StructLayout(LayoutKind.Sequential)]
    struct HIDD_ATTRIBUTES { public int Size; public ushort VendorID; public ushort ProductID; public ushort VersionNumber; }
    [DllImport("hid.dll")] static extern void HidD_GetHidGuid(out Guid g);
    [DllImport("hid.dll")] static extern bool HidD_GetAttributes(SafeFileHandle h, ref HIDD_ATTRIBUTES a);
    [DllImport("setupapi.dll", SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr w, int flags);
    [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr info, ref Guid g, int i, ref SP_DEVICE_INTERFACE_DATA d);
    [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA d, IntPtr detail, int size, out int required, IntPtr info);
    [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    static extern SafeFileHandle CreateFile(string name, uint access, uint share, IntPtr sec, uint mode, uint flags, IntPtr template);

    const ushort SONY = 0x054C;
    static readonly ushort[] DS4 = { 0x05C4, 0x09CC, 0x0BA0 };
    static readonly ushort[] DUALSENSE = { 0x0CE6, 0x0DF2 };
    static readonly Dictionary<string, Thread> hidReaders = new Dictionary<string, Thread>();
    static readonly object hidLock = new object();

    static List<string> HidPaths()
    {
        var list = new List<string>();
        Guid g;
        HidD_GetHidGuid(out g);
        IntPtr set = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12); // PRESENT | DEVICEINTERFACE
        if (set == new IntPtr(-1)) return list;
        try
        {
            var d = new SP_DEVICE_INTERFACE_DATA();
            d.cbSize = Marshal.SizeOf(d);
            for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref g, i, ref d); i++)
            {
                int need;
                SetupDiGetDeviceInterfaceDetail(set, ref d, IntPtr.Zero, 0, out need, IntPtr.Zero);
                IntPtr buf = Marshal.AllocHGlobal(need);
                try
                {
                    Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6); // cbSize of SP_DEVICE_INTERFACE_DETAIL_DATA
                    if (SetupDiGetDeviceInterfaceDetail(set, ref d, buf, need, out need, IntPtr.Zero))
                        list.Add(Marshal.PtrToStringAuto(new IntPtr(buf.ToInt64() + 4)));
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
        }
        finally { SetupDiDestroyDeviceInfoList(set); }
        return list;
    }

    static void ScanHid()
    {
        foreach (string p in HidPaths())
        {
            lock (hidLock) { if (hidReaders.ContainsKey(p)) continue; }
            // 0 access: only to ask what it is (works even when another app has the pad open)
            SafeFileHandle info = CreateFile(p, 0, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (info.IsInvalid) continue;
            var a = new HIDD_ATTRIBUTES();
            a.Size = Marshal.SizeOf(a);
            bool ok = HidD_GetAttributes(info, ref a);
            info.Dispose();
            if (!ok || a.VendorID != SONY) continue;
            bool dualsense = Array.IndexOf(DUALSENSE, a.ProductID) >= 0;
            if (!dualsense && Array.IndexOf(DS4, a.ProductID) < 0) continue;
            string path = p;
            string id = (dualsense ? "dualsense:" : "ds4:") + a.ProductID.ToString("x4");
            var t = new Thread(() => ReadHid(path, id, dualsense));
            t.IsBackground = true;
            lock (hidLock) { hidReaders[path] = t; }
            t.Start();
        }
    }

    static void ReadHid(string path, string id, bool dualsense)
    {
        try
        {
            using (SafeFileHandle h = CreateFile(path, 0x80000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) // GENERIC_READ, share read+write
            {
                if (h.IsInvalid) return;
                using (var fs = new FileStream(h, FileAccess.Read, 1024, false))
                {
                    var buf = new byte[1024];
                    bool was = false;
                    while (true)
                    {
                        int n = fs.Read(buf, 0, buf.Length);
                        if (n <= 0) break;
                        int at = PsByte(buf, n, dualsense);
                        bool down = at > 0 && at < n && (buf[at] & 0x01) != 0;
                        if (down && !was) Say("home " + id);
                        was = down;
                    }
                }
            }
        }
        catch (Exception) { }
        finally { lock (hidLock) { hidReaders.Remove(path); } }
    }

    /** Index of the byte whose lowest bit is the PS button, per report type. */
    static int PsByte(byte[] r, int n, bool dualsense)
    {
        if (n < 10) return -1;
        if (!dualsense)
        {
            if (r[0] == 0x01) return 7;           // USB, or Bluetooth "simple" report
            if (r[0] == 0x11) return 9;           // Bluetooth full report (2 bytes more in front)
            return -1;
        }
        if (r[0] == 0x01 && n >= 64) return 10;   // USB
        if (r[0] == 0x01) return 7;               // Bluetooth simple report
        if (r[0] == 0x31) return 11;              // Bluetooth full report
        return -1;
    }

    // ---------------- windows ----------------
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
    [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KEYBDINPUT ki; [FieldOffset(8)] public long pad0; [FieldOffset(16)] public long pad1; [FieldOffset(24)] public long pad2; }

    /** Visible top-level windows of the emulator process (all 8 emulators draw in their own process). */
    static List<IntPtr> Windows(uint pid)
    {
        var list = new List<IntPtr>();
        EnumWindows((h, l) =>
        {
            uint p;
            GetWindowThreadProcessId(h, out p);
            if (p == pid && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) list.Add(h); // GW_OWNER: top-level only
            return true;
        }, IntPtr.Zero);
        return list;
    }

    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

    /** The emulator's game window: its biggest visible window (Dolphin also has a small game-list window). */
    static bool Focus(uint pid)
    {
        var w = Windows(pid);
        if (w.Count == 0) return false;
        IntPtr best = w[0];
        long area = -1;
        foreach (var h in w)
        {
            RECT r;
            if (!GetWindowRect(h, out r)) continue;
            long a = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
            if (a > area) { area = a; best = h; }
        }
        return FocusHwnd(best);
    }

    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    /**
     * Windows only lets the app in front hand over the focus. Tried up to 3 times until the window really is
     * in front: joining the front window's input queue, then a tap of Alt (lifts the lock), then asking again.
     */
    static bool FocusHwnd(IntPtr h)
    {
        if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
        AllowSetForegroundWindow(-1);
        for (int i = 0; i < 3; i++)
        {
            IntPtr fg = GetForegroundWindow();
            if (fg == h) return true;
            uint dummy;
            uint fgThread = GetWindowThreadProcessId(fg, out dummy);
            uint me = GetCurrentThreadId();
            bool joined = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
            BringWindowToTop(h);
            SetForegroundWindow(h);
            if (joined) AttachThreadInput(me, fgThread, false);
            Thread.Sleep(40);
            if (GetForegroundWindow() == h) return true;
            Key(0x12, false);
            Key(0x12, true);
            SetForegroundWindow(h);
            Thread.Sleep(80);
            if (GetForegroundWindow() == h) return true;
        }
        return GetForegroundWindow() == h;
    }

    static void Key(ushort vk, bool up)
    {
        var i = new INPUT();
        i.type = 1; // keyboard
        i.ki.wVk = vk;
        i.ki.wScan = (ushort)MapVirtualKey(vk, 0);
        i.ki.dwFlags = (uint)(0x0008 | (up ? 0x0002 : 0)); // SCANCODE (emulators read scan codes) | KEYUP
        if (vk >= 0x21 && vk <= 0x2E) i.ki.dwFlags |= 0x0001; // extended keys (arrows, Ins/Del, Home/End)
        SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
    }

    static ushort Vk(string name)
    {
        string n = name.ToUpperInvariant();
        if (n == "SHIFT") return 0x10;
        if (n == "CTRL" || n == "CONTROL") return 0x11;
        if (n == "ALT") return 0x12;
        if (n == "ESC" || n == "ESCAPE") return 0x1B;
        if (n == "ENTER") return 0x0D;
        if (n == "SPACE") return 0x20;
        if (n == "TAB") return 0x09;
        if (n.Length > 1 && n[0] == 'F')
        {
            int f;
            if (int.TryParse(n.Substring(1), out f) && f >= 1 && f <= 24) return (ushort)(0x70 + f - 1);
        }
        if (n.Length == 1 && ((n[0] >= 'A' && n[0] <= 'Z') || (n[0] >= '0' && n[0] <= '9'))) return n[0];
        return 0;
    }

    static bool Keys(uint pid, string combo)
    {
        var parts = combo.Split('+');
        var vks = new List<ushort>();
        foreach (var p in parts)
        {
            ushort v = Vk(p.Trim());
            if (v == 0) return false;
            vks.Add(v);
        }
        if (!Focus(pid)) return false;
        foreach (var v in vks) { Key(v, false); Thread.Sleep(30); }
        Thread.Sleep(80); // long enough for emulators that poll the keyboard once per frame
        for (int i = vks.Count - 1; i >= 0; i--) { Key(vks[i], true); Thread.Sleep(20); }
        return true;
    }

    static bool Close(uint pid)
    {
        var w = Windows(pid);
        foreach (var h in w) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero); // WM_CLOSE: like clicking X
        return w.Count > 0;
    }

    // ---------------- per-app audio (like the Windows volume mixer) ----------------
    // Only used for Starstation's own tests: the couch test mutes the emulator it starts.
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr guid, int flags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, int flags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
    }
    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        // IAudioSessionControl
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName(out IntPtr name);
        [PreserveSig] int SetDisplayName(IntPtr name, IntPtr ctx);
        [PreserveSig] int GetIconPath(out IntPtr path);
        [PreserveSig] int SetIconPath(IntPtr path, IntPtr ctx);
        [PreserveSig] int GetGroupingParam(out Guid g);
        [PreserveSig] int SetGroupingParam(ref Guid g, IntPtr ctx);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr n);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr n);
        // IAudioSessionControl2
        [PreserveSig] int GetSessionIdentifier(out IntPtr id);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr id);
        [PreserveSig] int GetProcessId(out uint pid);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float level, ref Guid ctx);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute(bool mute, ref Guid ctx);
    }

    /** Mute / unmute every audio session of a process on every playback device. Returns how many were changed. */
    static int Mute(uint pid, bool mute)
    {
        int n = 0;
        var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDeviceCollection devs;
        if (en.EnumAudioEndpoints(0, 1, out devs) != 0) return 0; // render, active
        int count;
        devs.GetCount(out count);
        Guid iid = typeof(IAudioSessionManager2).GUID;
        Guid none = Guid.Empty;
        for (int d = 0; d < count; d++)
        {
            IMMDevice dev;
            if (devs.Item(d, out dev) != 0) continue;
            object o;
            if (dev.Activate(ref iid, 23, IntPtr.Zero, out o) != 0) continue; // CLSCTX_ALL
            var mgr = (IAudioSessionManager2)o;
            IAudioSessionEnumerator sessions;
            if (mgr.GetSessionEnumerator(out sessions) != 0) continue;
            int sc;
            sessions.GetCount(out sc);
            for (int i = 0; i < sc; i++)
            {
                IAudioSessionControl2 s;
                if (sessions.GetSession(i, out s) != 0) continue;
                uint p;
                if (s.GetProcessId(out p) == 0 && p == pid)
                {
                    ((ISimpleAudioVolume)s).SetMute(mute, ref none);
                    n++;
                }
            }
        }
        return n;
    }

    // ---------------- system settings (SPEC-v2 G: no Windows menus needed) ----------------
    static string J(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

    // sound output: the playback devices, and making one the default (Windows' own policy interface)
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator2
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection2 devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice2 device);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection2
    {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int Item(int index, out IMMDevice2 device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice2
    {
        [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
        [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    }
    [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
    [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public long pad; }
    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore
    {
        [PreserveSig] int GetCount(out int n);
        [PreserveSig] int GetAt(int i, out PROPERTYKEY k);
        [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    }
    [ComImport, Guid("870af99c-171d-4f9e-af0d-e63df40c2bc9")] class PolicyConfigClient { }
    [ComImport, Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig
    {
        [PreserveSig] int GetMixFormat(string id, IntPtr f);
        [PreserveSig] int GetDeviceFormat(string id, int def, IntPtr f);
        [PreserveSig] int ResetDeviceFormat(string id);
        [PreserveSig] int SetDeviceFormat(string id, IntPtr a, IntPtr b);
        [PreserveSig] int GetProcessingPeriod(string id, int def, IntPtr a, IntPtr b);
        [PreserveSig] int SetProcessingPeriod(string id, IntPtr a);
        [PreserveSig] int GetShareMode(string id, IntPtr m);
        [PreserveSig] int SetShareMode(string id, IntPtr m);
        [PreserveSig] int GetPropertyValue(string id, IntPtr k, IntPtr v);
        [PreserveSig] int SetPropertyValue(string id, IntPtr k, IntPtr v);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    }

    static string AudioList()
    {
        var en = (IMMDeviceEnumerator2)new MMDeviceEnumerator();
        IMMDevice2 def;
        string defId = "";
        if (en.GetDefaultAudioEndpoint(0, 1, out def) == 0) def.GetId(out defId);
        IMMDeviceCollection2 devs;
        if (en.EnumAudioEndpoints(0, 1, out devs) != 0) return "[]";
        int n;
        devs.GetCount(out n);
        var parts = new List<string>();
        var nameKey = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        for (int i = 0; i < n; i++)
        {
            IMMDevice2 d;
            if (devs.Item(i, out d) != 0) continue;
            string id;
            d.GetId(out id);
            string name = id;
            IPropertyStore ps;
            if (d.OpenPropertyStore(0, out ps) == 0)
            {
                PROPVARIANT v;
                if (ps.GetValue(ref nameKey, out v) == 0 && v.vt == 31) name = Marshal.PtrToStringUni(v.p);
            }
            parts.Add("{\"id\":" + J(id) + ",\"name\":" + J(name) + ",\"default\":" + (id == defId ? "true" : "false") + "}");
        }
        return "[" + string.Join(",", parts.ToArray()) + "]";
    }

    static bool AudioSet(string id)
    {
        var pc = (IPolicyConfig)new PolicyConfigClient();
        bool ok = true;
        for (int role = 0; role < 3; role++) ok &= pc.SetDefaultEndpoint(id, role) == 0; // console, multimedia, communications
        return ok;
    }

    // display: resolution + refresh rate of the main screen
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct DEVMODE
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);

    static DEVMODE NewMode() { var m = new DEVMODE(); m.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE)); return m; }

    static string DisplayList()
    {
        var cur = NewMode();
        EnumDisplaySettings(null, -1, ref cur); // ENUM_CURRENT_SETTINGS
        var seen = new HashSet<string>();
        var parts = new List<string>();
        var m = NewMode();
        for (int i = 0; EnumDisplaySettings(null, i, ref m); i++)
        {
            if (m.dmBitsPerPel != 32 || m.dmPelsWidth < 1024) continue;
            string k = m.dmPelsWidth + "x" + m.dmPelsHeight + "@" + m.dmDisplayFrequency;
            if (!seen.Add(k)) continue;
            bool now = m.dmPelsWidth == cur.dmPelsWidth && m.dmPelsHeight == cur.dmPelsHeight && m.dmDisplayFrequency == cur.dmDisplayFrequency;
            parts.Add("{\"w\":" + m.dmPelsWidth + ",\"h\":" + m.dmPelsHeight + ",\"hz\":" + m.dmDisplayFrequency + ",\"current\":" + (now ? "true" : "false") + "}");
        }
        return "[" + string.Join(",", parts.ToArray()) + "]";
    }

    /** test = only ask Windows whether the mode would work (nothing changes). */
    static int DisplaySet(int w, int h, int hz, bool test)
    {
        var m = NewMode();
        EnumDisplaySettings(null, -1, ref m);
        m.dmPelsWidth = w;
        m.dmPelsHeight = h;
        m.dmDisplayFrequency = hz;
        m.dmFields = 0x80000 | 0x100000 | 0x400000; // width, height, frequency
        return ChangeDisplaySettingsEx(null, ref m, IntPtr.Zero, test ? 0x2 : 0x1, IntPtr.Zero); // CDS_TEST : CDS_UPDATEREGISTRY
    }

    // Bluetooth: find controllers in pairing mode and pair them (Windows' classic Bluetooth API)
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct BLUETOOTH_DEVICE_INFO
    {
        public int dwSize;
        public ulong Address;
        public uint ulClassofDevice;
        public bool fConnected, fRemembered, fAuthenticated;
        public SYSTEMTIME stLastSeen, stLastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
    }
    [StructLayout(LayoutKind.Sequential)] struct SYSTEMTIME { public short a, b, c, d, e, f, g, h; }
    [StructLayout(LayoutKind.Sequential)]
    struct BLUETOOTH_DEVICE_SEARCH_PARAMS
    {
        public int dwSize;
        public bool fReturnAuthenticated, fReturnRemembered, fReturnUnknown, fReturnConnected, fIssueInquiry;
        public byte cTimeoutMultiplier;
        public IntPtr hRadio;
    }
    [DllImport("bthprops.cpl")] static extern IntPtr BluetoothFindFirstDevice(ref BLUETOOTH_DEVICE_SEARCH_PARAMS p, ref BLUETOOTH_DEVICE_INFO info);
    [DllImport("bthprops.cpl")] static extern bool BluetoothFindNextDevice(IntPtr h, ref BLUETOOTH_DEVICE_INFO info);
    [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr h);
    [DllImport("bthprops.cpl")] static extern int BluetoothAuthenticateDeviceEx(IntPtr hwnd, IntPtr radio, ref BLUETOOTH_DEVICE_INFO info, IntPtr oob, int auth);
    [DllImport("bthprops.cpl")] static extern int BluetoothSetServiceState(IntPtr radio, ref BLUETOOTH_DEVICE_INFO info, ref Guid service, int flags);
    [DllImport("bthprops.cpl")] static extern int BluetoothRemoveDevice(ref ulong address);

    static List<BLUETOOTH_DEVICE_INFO> BtDevices(bool scan)
    {
        var list = new List<BLUETOOTH_DEVICE_INFO>();
        var p = new BLUETOOTH_DEVICE_SEARCH_PARAMS();
        p.dwSize = Marshal.SizeOf(p);
        p.fReturnAuthenticated = p.fReturnRemembered = p.fReturnConnected = true;
        p.fReturnUnknown = scan;
        p.fIssueInquiry = scan;
        p.cTimeoutMultiplier = (byte)(scan ? 6 : 0); // 6 × 1.28 s
        var d = new BLUETOOTH_DEVICE_INFO();
        d.dwSize = Marshal.SizeOf(d);
        IntPtr h;
        try { h = BluetoothFindFirstDevice(ref p, ref d); }
        catch (Exception) { return list; } // no Bluetooth on this PC
        if (h == IntPtr.Zero) return list;
        do { list.Add(d); d = new BLUETOOTH_DEVICE_INFO(); d.dwSize = Marshal.SizeOf(d); } while (BluetoothFindNextDevice(h, ref d));
        BluetoothFindDeviceClose(h);
        return list;
    }

    static string BtList(bool scan)
    {
        var parts = new List<string>();
        foreach (var d in BtDevices(scan))
            parts.Add("{\"address\":\"" + d.Address.ToString("X12") + "\",\"name\":" + J(d.szName) + ",\"connected\":" + (d.fConnected ? "true" : "false") + ",\"paired\":" + (d.fAuthenticated || d.fRemembered ? "true" : "false") + ",\"cod\":" + d.ulClassofDevice + "}");
        return "[" + string.Join(",", parts.ToArray()) + "]";
    }

    static string BtPair(string address)
    {
        ulong a = Convert.ToUInt64(address, 16);
        foreach (var d0 in BtDevices(true))
        {
            if (d0.Address != a) continue;
            var d = d0;
            int r = BluetoothAuthenticateDeviceEx(IntPtr.Zero, IntPtr.Zero, ref d, IntPtr.Zero, 0); // no PIN: controllers "just work"
            var hid = new Guid("00001124-0000-1000-8000-00805F9B34FB");
            int s = BluetoothSetServiceState(IntPtr.Zero, ref d, ref hid, 1); // switch on the controller (HID) service
            return (r == 0 || r == 183) && (s == 0 || s == 183) ? "ok" : "failed " + r + "/" + s; // 183: already done
        }
        return "not found";
    }

    /** Every connected XInput pad as last read: "slot:lx,ly,rx,ry,lt,rt,buttons;…" (the poll keeps it current; asking
     *  Windows again here would include the slow empty slots). */
    static volatile string lastXState = "";

    // ---------------- main ----------------
    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        // XInput: asking about an EMPTY slot can be very slow (Hannes's PC with two DsHidMini pads: ~70 ms per call,
        // it makes Windows look at every XInput device). So only connected slots are read every 16 ms; empty slots
        // and new PlayStation pads are looked for every 2 s on their own thread, which never holds up the fast one.
        var connected = new bool[4];
        var probe = new Thread(() =>
        {
            while (true)
            {
                for (uint i = 0; i < 4; i++)
                {
                    if (Volatile.Read(ref connected[i])) continue;
                    var s = new XState();
                    uint r;
                    try { r = XInputGetStateEx(i, ref s); }
                    catch (Exception) { r = 1; }
                    if (r == 0) Volatile.Write(ref connected[i], true);
                }
                try { ScanHid(); } catch (Exception) { }
                Thread.Sleep(2000);
            }
        });
        probe.IsBackground = true;
        probe.Start();

        var poll = new Thread(() =>
        {
            var was = new bool[4];
            var packets = new uint[4];
            string lastPads = null, lastState = null;
            while (true)
            {
                var pads = new List<string>();
                var state = new List<string>();
                for (uint i = 0; i < 4; i++)
                {
                    if (!Volatile.Read(ref connected[i])) { was[i] = false; continue; }
                    var s = new XState();
                    uint r;
                    try { r = XInputGetStateEx(i, ref s); }
                    catch (Exception) { r = 1; }
                    if (r != 0) { Volatile.Write(ref connected[i], false); was[i] = false; continue; }
                    bool down = (s.Gamepad.wButtons & GUIDE) != 0;
                    pads.Add("xinput:" + i);
                    if (down && !was[i]) Say("home xinput:" + i);
                    was[i] = down;
                    var g = s.Gamepad;
                    state.Add(i + ":" + g.sThumbLX + "," + g.sThumbLY + "," + g.sThumbRX + "," + g.sThumbRY + "," + g.bLeftTrigger + "," + g.bRightTrigger + "," + g.wButtons);
                    packets[i] = s.dwPacketNumber;
                }
                lock (hidLock) { pads.Add("hid:" + hidReaders.Count); }
                string now = string.Join(",", pads.ToArray());
                if (now != lastPads) { Say("pads " + now); lastPads = now; }
                // the menu reads Xbox-style pads from here (Chromium's own reading asks about empty slots ~60 times a
                // second): every change, as one line with all connected pads
                string st = string.Join(";", state.ToArray());
                lastXState = st;
                if (st != lastState) { Say("xpads " + st); lastState = st; }
                Thread.Sleep(16);
            }
        });
        poll.IsBackground = true;
        poll.Start();
        Say("ready");

        string line;
        while ((line = Console.In.ReadLine()) != null)
        {
            var a = line.Trim().Split(new[] { ' ' }, 3);
            if (a.Length == 0 || a[0].Length == 0) continue;
            try
            {
                uint pid = 0;
                if (a.Length > 1) uint.TryParse(a[1], out pid); // only some commands take a process id
                switch (a[0])
                {
                    case "quit": return;
                    case "xstate": Say("xstate " + lastXState); break;
                    case "fg":
                        {
                            uint p;
                            GetWindowThreadProcessId(GetForegroundWindow(), out p);
                            Say("fg " + p);
                            break;
                        }
                    case "close": Say(Close(pid) ? "ok close" : "err close no window"); break;
                    case "focus": Say(Focus(pid) ? "ok focus" : "err focus no window"); break;
                    case "audio": Say("audio " + AudioList()); break;
                    case "audioset": Say(a.Length > 1 && AudioSet(line.Trim().Substring(9)) ? "ok audioset" : "err audioset"); break;
                    case "display": Say("display " + DisplayList()); break;
                    case "displayset":
                    case "displaytest":
                        {
                            // displayset <w> <h> <hz> (all in a[1] + a[2] split again)
                            var v = line.Trim().Split(' ');
                            int r = DisplaySet(int.Parse(v[1]), int.Parse(v[2]), int.Parse(v[3]), a[0] == "displaytest");
                            Say(r == 0 ? "ok " + a[0] : "err " + a[0] + " " + r);
                            break;
                        }
                    case "bt": Say("bt " + BtList(a.Length > 1 && a[1] == "scan")); break;
                    case "btpair": { string r = BtPair(a.Length > 1 ? a[1] : ""); Say(r == "ok" ? "ok btpair" : "err btpair " + r); break; }
                    case "btremove": { ulong ad = Convert.ToUInt64(a.Length > 1 ? a[1] : "0", 16); Say(BluetoothRemoveDevice(ref ad) == 0 ? "ok btremove" : "err btremove"); break; }
                    case "idle":
                        {
                            // ms since the last keyboard / mouse input (couch test waits until nobody uses the PC)
                            var li = new LASTINPUTINFO();
                            li.cbSize = (uint)Marshal.SizeOf(li);
                            GetLastInputInfo(ref li);
                            Say("idle " + unchecked((uint)Environment.TickCount - li.dwTime));
                            break;
                        }
                    case "focushwnd":
                        {
                            // a window by its handle (Starstation's PS button menu: the same process owns two windows)
                            long hwnd = a.Length > 1 ? long.Parse(a[1]) : 0;
                            Say(hwnd != 0 && FocusHwnd(new IntPtr(hwnd)) ? "ok focushwnd" : "err focushwnd");
                            break;
                        }
                    case "keys": Say(a.Length > 2 && Keys(pid, a[2]) ? "ok keys" : "err keys " + (a.Length > 2 ? a[2] : "")); break;
                    case "mute":
                        {
                            int n = Mute(pid, a.Length < 3 || a[2] != "0");
                            Say(n > 0 ? "ok mute " + n : "err mute no audio yet");
                            break;
                        }
                    default: Say("err " + a[0] + " unknown"); break;
                }
            }
            catch (Exception e) { Say("err " + a[0] + " " + e.Message.Replace('\n', ' ')); }
        }
    }
}
