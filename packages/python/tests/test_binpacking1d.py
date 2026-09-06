import unittest
from wood_cutting_optimizer.binpacking import (
    bin_pack_1d,
    BinDefinition,
    ItemDefinition,
    BinPacking1DOptions,
)


class TestGenericBinPacking1D(unittest.TestCase):
    def test_pack_items_without_spacing(self):
        bins = [
            BinDefinition(id="bin-1", capacity=100.0, quantity=2),
        ]
        items = [
            ItemDefinition(id="item-1", size=60.0, quantity=1),
            ItemDefinition(id="item-2", size=40.0, quantity=1),
            ItemDefinition(id="item-3", size=50.0, quantity=1),
            ItemDefinition(id="item-4", size=50.0, quantity=1),
        ]

        result = bin_pack_1d(bins, items)

        self.assertEqual(len(result.bins), 2)
        self.assertEqual(len(result.unpacked_items), 0)
        self.assertEqual(result.summary.items_packed, 4)
        self.assertEqual(result.summary.items_total, 4)
        self.assertEqual(result.summary.total_capacity, 200.0)
        self.assertEqual(result.summary.total_item_size, 200.0)
        self.assertEqual(result.summary.average_utilization, 1.0)

        for b in result.bins:
            self.assertEqual(b.used_capacity, 100.0)
            self.assertEqual(b.remaining_capacity, 0.0)
            self.assertEqual(b.utilization, 1.0)

    def test_respect_item_spacing(self):
        bins = [
            BinDefinition(id="bin-1", capacity=100.0, quantity=2),
        ]
        items = [
            ItemDefinition(id="item-1", size=40.0, quantity=2),
            ItemDefinition(id="item-2", size=20.0, quantity=1),
        ]

        # spacing = 5.0
        # In bin 1: item(40) + spacing(5) + item(40) = 85 <= 100
        # item(20) won't fit into bin 1 (85 + 5 + 20 = 110 > 100), placed in bin 2
        result = bin_pack_1d(bins, items, BinPacking1DOptions(item_spacing=5.0))

        self.assertEqual(len(result.bins), 2)
        bin1 = result.bins[0]
        self.assertEqual(len(bin1.items), 2)
        self.assertEqual(bin1.items[0].offset, 0.0)
        self.assertEqual(bin1.items[0].size, 40.0)
        self.assertEqual(bin1.items[1].offset, 45.0)
        self.assertEqual(bin1.items[1].size, 40.0)
        self.assertEqual(bin1.used_capacity, 85.0)
        self.assertEqual(bin1.remaining_capacity, 15.0)

        bin2 = result.bins[1]
        self.assertEqual(len(bin2.items), 1)
        self.assertEqual(bin2.items[0].offset, 0.0)
        self.assertEqual(bin2.items[0].size, 20.0)

    def test_heterogeneous_bin_selection(self):
        bins = [
            BinDefinition(id="small-bin", capacity=50.0, quantity=5),
            BinDefinition(id="large-bin", capacity=100.0, quantity=5),
        ]
        items = [
            ItemDefinition(id="item-small", size=45.0, quantity=1),
        ]

        result = bin_pack_1d(bins, items)
        self.assertEqual(len(result.bins), 1)
        self.assertEqual(result.bins[0].bin_id, "small-bin")
        self.assertEqual(result.bins[0].capacity, 50.0)

    def test_unpacked_items_tracking(self):
        bins = [
            BinDefinition(id="bin-1", capacity=50.0, quantity=1),
        ]
        items = [
            ItemDefinition(id="item-1", size=40.0, quantity=1),
            ItemDefinition(id="item-2", size=30.0, quantity=1),
            ItemDefinition(id="item-huge", size=100.0, quantity=2),
        ]

        result = bin_pack_1d(bins, items)
        self.assertEqual(len(result.bins), 1)
        self.assertEqual(len(result.unpacked_items), 2)

        unpacked_dict = {u.id: u.quantity for u in result.unpacked_items}
        self.assertEqual(unpacked_dict.get("item-huge"), 2)
        self.assertEqual(unpacked_dict.get("item-2"), 1)

    def test_preserve_metadata(self):
        bins = [
            BinDefinition(id="b1", capacity=100.0, data={"warehouse": "Tokyo-1"}),
        ]
        items = [
            ItemDefinition(id="i1", size=50.0, data={"sku": "SKU-999"}),
        ]

        result = bin_pack_1d(bins, items)
        self.assertEqual(result.bins[0].data, {"warehouse": "Tokyo-1"})
        self.assertEqual(result.bins[0].items[0].data, {"sku": "SKU-999"})


if __name__ == "__main__":
    unittest.main()
