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

    // ---------------- main ----------------
    static void Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        var poll = new Thread(() =>
        {
            var was = new bool[4];
            string lastPads = null;
            int tick = 0;
            while (true)
            {
                var pads = new List<string>();
                for (uint i = 0; i < 4; i++)
                {
                    var s = new XState();
                    uint r;
                    try { r = XInputGetStateEx(i, ref s); }
                    catch (Exception) { r = 1; }
                    bool connected = r == 0;
                    bool down = connected && (s.Gamepad.wButtons & GUIDE) != 0;
                    if (connected) pads.Add("xinput:" + i);
                    if (down && !was[i]) Say("home xinput:" + i);
                    was[i] = down;
                }
                if (tick % 180 == 0) ScanHid(); // every 3 s: newly connected PlayStation pads
                lock (hidLock) { pads.Add("hid:" + hidReaders.Count); }
                string now = string.Join(",", pads.ToArray());
                if (now != lastPads) { Say("pads " + now); lastPads = now; }
                tick++;
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
                uint pid = a.Length > 1 && a[0] != "focushwnd" ? uint.Parse(a[1]) : 0;
                switch (a[0])
                {
                    case "quit": return;
                    case "fg":
                        {
                            uint p;
                            GetWindowThreadProcessId(GetForegroundWindow(), out p);
                            Say("fg " + p);
                            break;
                        }
                    case "close": Say(Close(pid) ? "ok close" : "err close no window"); break;
                    case "focus": Say(Focus(pid) ? "ok focus" : "err focus no window"); break;
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
