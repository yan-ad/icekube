import unittest
from macos_apps import Timebase, Usage, cpu_delta, percentile, summarize, ticks_to_ns
import ctypes


def row(pid, start, cpu, footprint=1048576):
    return {"pid": pid, "start": start, "cpu_ns": cpu,
            "footprint_bytes": footprint, "rss_bytes": 2 * footprint}


class AccountingTests(unittest.TestCase):
    def test_sdk_v2_layout(self):
        self.assertEqual(ctypes.sizeof(Usage), 160)
        self.assertEqual(Usage.phys_footprint.offset, 72)

    def test_cpu_new_process_and_pid_reuse(self):
        self.assertEqual(cpu_delta([row(1, 10, 100)], [row(1, 10, 150), row(2, 20, 25)]), 50)
        self.assertEqual(cpu_delta([row(1, 10, 100)], [row(1, 30, 10)]), 0)

    def test_newly_attributed_lifetime_cpu_is_not_charged(self):
        self.assertEqual(cpu_delta([row(1, 10, 100)], [row(1, 10, 150), row(2, 5, 9_000_000_000)]), 50)

    def test_mach_ticks_are_converted_on_apple_silicon(self):
        self.assertEqual(ticks_to_ns(24_000_000, Timebase(125, 3)), 1_000_000_000)
        self.assertEqual(ticks_to_ns(123, Timebase(1, 1)), 123)
        with self.assertRaises(ValueError):
            ticks_to_ns(123, Timebase(1, 0))

    def test_one_core_cpu_and_memory_units(self):
        samples = [{"elapsed_s": 0, "app": [row(1, 10, 0)]},
                   {"elapsed_s": 2, "app": [row(1, 10, 1_000_000_000)]},
                   {"elapsed_s": 4, "app": [row(1, 10, 2_000_000_000)]}]
        result = summarize(samples, "app")
        self.assertEqual(result["cpu_percent_mean_one_core"], 50)
        self.assertEqual(result["footprint_mib_median"], 1)
        self.assertEqual(result["rss_mib_median"], 2)
        self.assertEqual(result["processes_left_accounting"], 0)
        self.assertEqual(result["processes_joined_accounting"], 0)

    def test_exits_are_reported(self):
        samples = [{"elapsed_s": 0, "app": [row(1, 10, 0), row(2, 20, 0)]},
                   {"elapsed_s": 1, "app": [row(1, 10, 10)]}]
        self.assertEqual(summarize(samples, "app")["processes_left_accounting"], 1)

    def test_percentile_interpolation(self):
        self.assertEqual(percentile([0, 10], .95), 9.5)


if __name__ == "__main__":
    unittest.main()
