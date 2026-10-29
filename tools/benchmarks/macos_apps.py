#!/usr/bin/env python3
"""Read-only process accounting for installed Iceon and Freelens on macOS."""

import argparse
import ctypes
import datetime
import json
import math
import os
from pathlib import Path
import platform
import plistlib
import statistics
import subprocess
import sys
import time

APPS = {
    "iceon": Path("/Applications/Iceon.app"),
    "freelens": Path("/Applications/Freelens.app"),
}


class Usage(ctypes.Structure):
    # rusage_info_v2 from sys/resource.h. CPU counters need Mach timebase conversion.
    _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64)
        for name in (
            "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups",
            "pageins", "wired_size", "resident_size", "phys_footprint",
            "proc_start_abstime", "proc_exit_abstime", "child_user_time",
            "child_system_time", "child_pkg_idle_wkups", "child_interrupt_wkups",
            "child_pageins", "child_elapsed_abstime", "diskio_bytesread",
            "diskio_byteswritten",
        )
    ]


class Timebase(ctypes.Structure):
    _fields_ = [("numer", ctypes.c_uint32), ("denom", ctypes.c_uint32)]


def ticks_to_ns(ticks, timebase):
    if timebase.numer <= 0 or timebase.denom <= 0:
        raise ValueError("Invalid Mach timebase")
    return ticks * timebase.numer // timebase.denom


def native_api():
    lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    lib.proc_pid_rusage.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_void_p]
    lib.proc_pid_rusage.restype = ctypes.c_int
    lib.responsibility_get_pid_responsible_for_pid.argtypes = [ctypes.c_int]
    lib.responsibility_get_pid_responsible_for_pid.restype = ctypes.c_int
    lib.mach_timebase_info.argtypes = [ctypes.POINTER(Timebase)]
    lib.mach_timebase_info.restype = ctypes.c_int
    timebase = Timebase()
    if lib.mach_timebase_info(ctypes.byref(timebase)) != 0:
        raise RuntimeError("Cannot read Mach timebase")
    ticks_to_ns(0, timebase)
    return lib, timebase


def calibrate(lib, timebase):
    before, after = Usage(), Usage()
    if lib.proc_pid_rusage(os.getpid(), 2, ctypes.byref(before)) != 0:
        raise RuntimeError("Cannot calibrate CPU clock")
    start = time.process_time_ns()
    while time.process_time_ns() - start < 150_000_000:
        pass
    elapsed = time.process_time_ns() - start
    if lib.proc_pid_rusage(os.getpid(), 2, ctypes.byref(after)) != 0:
        raise RuntimeError("Cannot calibrate CPU clock")
    measured = ticks_to_ns(after.user_time + after.system_time - before.user_time - before.system_time, timebase)
    ratio = measured / elapsed
    if not .9 <= ratio <= 1.1:
        raise RuntimeError(f"CPU counter calibration failed: {ratio}")
    return {"process_time_ns": elapsed, "native_cpu_ns": measured, "ratio": ratio}


def percentile(values, fraction):
    ordered = sorted(values)
    index = (len(ordered) - 1) * fraction
    low, high = math.floor(index), math.ceil(index)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def cpu_delta(previous, current):
    """Do not combine counters across PID reuse or count child CPU twice."""
    old = {(p["pid"], p["start"]): p["cpu_ns"] for p in previous}
    return sum(
        max(0, p["cpu_ns"] - old[(p["pid"], p["start"])])
        for p in current
        if (p["pid"], p["start"]) in old
    )


def summarize(samples, app):
    footprints = [sum(p["footprint_bytes"] for p in s[app]) / 2**20 for s in samples[1:]]
    resident = [sum(p["rss_bytes"] for p in s[app]) / 2**20 for s in samples[1:]]
    cpu_seconds = []
    cpu_percent = []
    left = set()
    joined = set()
    for before, after in zip(samples, samples[1:]):
        seconds = cpu_delta(before[app], after[app]) / 1e9
        cpu_seconds.append(seconds)
        cpu_percent.append(100 * seconds / (after["elapsed_s"] - before["elapsed_s"]))
        current = {(p["pid"], p["start"]) for p in after[app]}
        previous = {(p["pid"], p["start"]) for p in before[app]}
        left.update(previous - current)
        joined.update(current - previous)
    elapsed = samples[-1]["elapsed_s"] - samples[0]["elapsed_s"]
    return {
        "duration_s": elapsed,
        "intervals": len(cpu_seconds),
        "footprint_mib_median": statistics.median(footprints),
        "footprint_mib_p95": percentile(footprints, .95),
        "footprint_mib_min": min(footprints),
        "footprint_mib_max": max(footprints),
        "rss_mib_median": statistics.median(resident),
        "cpu_seconds": sum(cpu_seconds),
        "cpu_percent_mean_one_core": 100 * sum(cpu_seconds) / elapsed,
        "cpu_percent_p95_one_core": percentile(cpu_percent, .95),
        "process_count_min": min(len(s[app]) for s in samples),
        "process_count_max": max(len(s[app]) for s in samples),
        "processes_left_accounting": len(left),
        "processes_joined_accounting": len(joined),
    }


def capture(lib, timebase, roots, executables, root_starts):
    listing = subprocess.check_output(["ps", "-axo", "pid=,ppid=,comm="], text=True)
    processes = {}
    for line in listing.splitlines():
        pid, parent, command = line.strip().split(None, 2)
        processes[int(pid)] = (int(parent), command)
    for app, pid in roots.items():
        if processes.get(pid, (None, None))[1] != executables[app]:
            raise RuntimeError(f"{app} exited or restarted; discard this trial")
    groups = {app: {pid} for app, pid in roots.items()}
    for pid in processes:
        responsible = lib.responsibility_get_pid_responsible_for_pid(pid)
        for app, root in roots.items():
            if responsible == root:
                groups[app].add(pid)
    for group in groups.values():
        changed = True
        while changed:
            children = {pid for pid, (parent, _) in processes.items() if parent in group}
            changed = not children.issubset(group)
            group.update(children)
    if groups["iceon"] & groups["freelens"]:
        raise RuntimeError("Ambiguous process ownership")
    result = {}
    for app, pids in groups.items():
        rows = []
        for pid in sorted(pids):
            usage = Usage()
            if lib.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
                raise RuntimeError(f"Cannot account for {app} process {pid}; discard this trial")
            if pid == roots[app] and usage.proc_start_abstime != root_starts[app]:
                raise RuntimeError(f"{app} root identity changed; discard this trial")
            rows.append({
                "pid": pid, "start": usage.proc_start_abstime,
                "process": Path(processes[pid][1]).name,
                "cpu_ticks": usage.user_time + usage.system_time,
                "cpu_ns": ticks_to_ns(usage.user_time + usage.system_time, timebase),
                "footprint_bytes": usage.phys_footprint,
                "rss_bytes": usage.resident_size,
            })
        result[app] = rows
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--seconds", type=int, default=60)
    parser.add_argument("--state", required=True, help="Public, non-sensitive workload description")
    args = parser.parse_args()
    if sys.platform != "darwin" or args.rounds < 1 or args.seconds < 1:
        parser.error("Requires macOS and positive rounds/seconds")
    if args.output.exists():
        parser.error("Output must not already exist")
    lib, timebase = native_api()
    calibration = calibrate(lib, timebase)
    identities, executables, roots = {}, {}, {}
    listing = subprocess.check_output(["ps", "-axo", "pid=,comm="], text=True)
    for app, path in APPS.items():
        info = plistlib.loads((path / "Contents/Info.plist").read_bytes())
        executable = str(path / "Contents/MacOS" / info["CFBundleExecutable"])
        matches = [int(line.strip().split(None, 1)[0]) for line in listing.splitlines()
                   if line.strip().split(None, 1)[1] == executable]
        if len(matches) != 1:
            raise RuntimeError(f"Expected exactly one running installed {app}")
        roots[app], executables[app] = matches[0], executable
        identities[app] = {"version": info["CFBundleShortVersionString"], "path": str(path), "pid": matches[0]}
    root_starts = {}
    for app, pid in roots.items():
        usage = Usage()
        if lib.proc_pid_rusage(pid, 2, ctypes.byref(usage)) != 0:
            raise RuntimeError(f"Cannot identify {app}")
        root_starts[app] = usage.proc_start_abstime
    output = {
        "schema": 2, "started_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "hardware": {"chip": subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip(),
                     "ram_bytes": int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True)),
                     "logical_cpus": os.cpu_count(), "macos": platform.mac_ver()[0]},
        "apps": identities, "workload_user_confirmed": args.state,
        "method": "1 Hz proc_pid_rusage v2 physical footprint; responsibility owner plus recursive descendants; Mach-timebase converted CPU-time deltas, 100% = one core",
        "mach_timebase": {"numer": timebase.numer, "denom": timebase.denom},
        "cpu_clock_calibration": calibration,
        "limitations": ["Workload/view equivalence is user-confirmed; Accessibility access denied",
                        "Concurrent apps, existing profiles and unrelated host activity; not controlled cold starts",
                        "CPU uses stable process identities only; joins baseline lifetime counters and leaves lose final deltas; sub-second helpers may be missed",
                        "Process listings and native counters are sequential, not an atomic system snapshot",
                        "Not latency, energy, GPU utilization, network throughput, or feature-parity measurements",
                        "Physical-footprint sums are process charges, not unique system-wide pages"],
        "rounds": [],
    }
    for index in range(args.rounds):
        start = time.monotonic()
        samples = []
        for tick in range(args.seconds + 1):
            time.sleep(max(0, start + tick - time.monotonic()))
            begin = time.monotonic()
            sample = capture(lib, timebase, roots, executables, root_starts)
            sample["elapsed_s"] = time.monotonic() - start
            sample["capture_s"] = time.monotonic() - begin
            sample["host_load_1m"] = os.getloadavg()[0]
            samples.append(sample)
        round_data = {"index": index + 1, "samples": samples,
                      "summary": {app: summarize(samples, app) for app in APPS}}
        output["rounds"].append(round_data)
        print(json.dumps({"round": index + 1, "summary": round_data["summary"]}), flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x") as file:
        json.dump(output, file, indent=2)
        file.write("\n")
    print(f"Saved {args.output}")


if __name__ == "__main__":
    main()
