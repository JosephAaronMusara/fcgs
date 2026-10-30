import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ShoppingCart, Plus, Package, DollarSign, Download, Trash2, MinusCircle, PlusCircle } from "lucide-react";
import { useTableSort } from "@/hooks/use-table-sort";
import { SortableTableHead } from "@/components/sortable-table-head";
import type { PosItem, PosSale } from "@shared/schema";

interface CartItem {
  item: PosItem;
  quantity: number;
}

export default function POSPage() {
  const { toast } = useToast();
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);

  const { data: items = [], isLoading } = useQuery<PosItem[]>({
    queryKey: ["/api/pos/items"],
  });

  const { data: sales = [] } = useQuery<PosSale[]>({
    queryKey: ["/api/pos/sales"],
  });

  const { sortedData: sortedItems, sortConfig: itemsSortConfig, requestSort: requestItemsSort } = useTableSort(items);
  const { sortedData: sortedSales, sortConfig: salesSortConfig, requestSort: requestSalesSort } = useTableSort(sales);

  const createItem = useMutation({
    mutationFn: async (data: Partial<PosItem>) => {
      return apiRequest("POST", "/api/pos/items", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/items"] });
      setIsAddItemOpen(false);
      toast({ title: "Item added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add item", variant: "destructive" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/pos/items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/pos/items"] });
      toast({ title: "Item deleted" });
    },
  });

  const createSale = useMutation({
    mutationFn: async (data: { items: { itemId: number; quantity: number }[] }) => {
      const response = await apiRequest("POST", "/api/pos/sales", {
        paymentMethod: "cash",
        items: data.items,
      });
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/pos/items"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/pos/sales"] }),
      ]);
      setCart([]);
      toast({ title: "Sale completed!" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to complete sale", description: error.message, variant: "destructive" });
    },
  });

  const handleAddItem = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createItem.mutate({
      name: formData.get("name") as string,
      description: formData.get("description") as string,
      price: formData.get("price") as string,
      category: formData.get("category") as string,
      stockQty: Number.parseInt(String(formData.get("stockQty") || "0"), 10) || 0,
    });
  };

  const addToCart = (item: PosItem) => {
    const available = item.stockQty ?? 0;
    if (available <= 0) {
      toast({ title: "Out of stock", description: `${item.name} is not currently available.`, variant: "destructive" });
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        if (existing.quantity >= available) {
          toast({ title: "Stock limit reached", description: `Only ${available} unit${available === 1 ? "" : "s"} available.` });
          return prev;
        }
        return prev.map((c) =>
          c.item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { item, quantity: 1 }];
    });
  };

  const updateQuantity = (itemId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => {
          if (c.item.id !== itemId) return c;
          const available = c.item.stockQty ?? 0;
          return { ...c, quantity: Math.min(available, Math.max(0, c.quantity + delta)) };
        })
        .filter((c) => c.quantity > 0)
    );
  };

  const cartTotal = cart.reduce(
    (sum, c) => sum + parseFloat(c.item.price) * c.quantity,
    0
  );

  const handleCheckout = () => {
    if (cart.length === 0) return;
    createSale.mutate({
      items: cart.map((c) => ({
        itemId: c.item.id,
        quantity: c.quantity,
      })),
    });
  };

  const exportToSage = () => {
    const csvContent = [
      ["Date", "Description", "Debit", "Credit", "Account Code"],
      ...sales.map((sale) => [
        sale.saleDate ? new Date(sale.saleDate).toISOString() : "",
        `POS Sale #${sale.id}`,
        sale.totalAmount,
        "",
        "4000",
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `POS_Sage_Export_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export downloaded" });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-8 w-8" style={{ color: "#1b2a5c" }} />
          <div>
            <h1 className="text-3xl font-bold tracking-tight" style={{ color: "#1b2a5c" }}>Point of Sale</h1>
            <p className="text-muted-foreground">Sell school items and manage inventory</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportToSage} data-testid="button-export-sage">
            <Download className="h-4 w-4 mr-2" />
            Download Sage CSV
          </Button>
          <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-item">
                <Plus className="h-4 w-4 mr-2" />
                Add Item
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Item</DialogTitle>
                <DialogDescription>Add a new product to sell</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddItem} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Item Name</Label>
                  <Input id="name" name="name" required data-testid="input-item-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input id="description" name="description" data-testid="input-item-description" />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="price">Price ($)</Label>
                    <Input id="price" name="price" type="number" step="0.01" required data-testid="input-item-price" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stockQty">Stock Quantity</Label>
                    <Input id="stockQty" name="stockQty" type="number" data-testid="input-stock" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Input id="category" name="category" placeholder="e.g., Uniform, Stationery" data-testid="input-category" />
                </div>
                <Button type="submit" className="w-full" disabled={createItem.isPending} data-testid="button-submit-item">
                  Add Item
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="sell" className="space-y-4">
        <TabsList data-testid="tabs-pos">
          <TabsTrigger value="sell" data-testid="tab-sell">Sell</TabsTrigger>
          <TabsTrigger value="inventory" data-testid="tab-inventory">Inventory</TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">Sales History</TabsTrigger>
        </TabsList>

        <TabsContent value="sell">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Products
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">No items yet. Add some products first.</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      {items.map((item) => (
                        <Card
                          key={item.id}
                          className={(item.stockQty ?? 0) > 0 ? "cursor-pointer hover-elevate" : "cursor-not-allowed opacity-60"}
                          onClick={() => addToCart(item)}
                          data-testid={`card-item-${item.id}`}
                        >
                          <CardContent className="p-4">
                            <h4 className="font-semibold truncate">{item.name}</h4>
                            <p className="text-sm text-muted-foreground truncate">{item.category || "Uncategorized"}</p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="font-bold text-primary">${item.price}</span>
                              <Badge variant="outline">{item.stockQty ?? 0} in stock</Badge>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Cart ({cart.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {cart.length === 0 ? (
                    <p className="text-center py-8 text-muted-foreground">Cart is empty</p>
                  ) : (
                    <div className="space-y-4">
                      {cart.map((c) => (
                        <div key={c.item.id} className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium">{c.item.name}</p>
                            <p className="text-sm text-muted-foreground">
                              ${c.item.price} x {c.quantity}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => updateQuantity(c.item.id, -1)}
                            >
                              <MinusCircle className="h-4 w-4" />
                            </Button>
                            <span className="w-8 text-center">{c.quantity}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => updateQuantity(c.item.id, 1)}
                              disabled={c.quantity >= (c.item.stockQty ?? 0)}
                            >
                              <PlusCircle className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <div className="border-t pt-4">
                        <div className="flex items-center justify-between font-bold text-lg">
                          <span>Total:</span>
                          <span>${cartTotal.toFixed(2)}</span>
                        </div>
                        <Button
                          className="w-full mt-4"
                          onClick={handleCheckout}
                          disabled={createSale.isPending}
                          data-testid="button-checkout"
                        >
                          <DollarSign className="h-4 w-4 mr-2" />
                          Complete Sale
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <Card>
            <CardHeader>
              <CardTitle>Inventory Management</CardTitle>
              <CardDescription>Manage your product stock</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="name" sortConfig={itemsSortConfig} onSort={requestItemsSort}>Item</SortableTableHead>
                    <SortableTableHead sortKey="category" sortConfig={itemsSortConfig} onSort={requestItemsSort}>Category</SortableTableHead>
                    <SortableTableHead sortKey="price" sortConfig={itemsSortConfig} onSort={requestItemsSort}>Price</SortableTableHead>
                    <SortableTableHead sortKey="stockQty" sortConfig={itemsSortConfig} onSort={requestItemsSort}>Stock</SortableTableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedItems ?? []).map((item) => (
                    <TableRow key={item.id} data-testid={`row-item-${item.id}`}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.category || "-"}</TableCell>
                      <TableCell>${item.price}</TableCell>
                      <TableCell>
                        <Badge variant={(item.stockQty ?? 0) > 10 ? "default" : "destructive"}>
                          {item.stockQty ?? 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteItem.mutate(item.id)}
                          data-testid={`button-delete-item-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Sales History</CardTitle>
              <CardDescription>Recent transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead sortKey="id" sortConfig={salesSortConfig} onSort={requestSalesSort}>Sale ID</SortableTableHead>
                    <SortableTableHead sortKey="saleDate" sortConfig={salesSortConfig} onSort={requestSalesSort}>Date</SortableTableHead>
                    <SortableTableHead sortKey="totalAmount" sortConfig={salesSortConfig} onSort={requestSalesSort}>Total</SortableTableHead>
                    <SortableTableHead sortKey="paymentMethod" sortConfig={salesSortConfig} onSort={requestSalesSort}>Payment</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(sortedSales ?? []).map((sale) => (
                    <TableRow key={sale.id} data-testid={`row-sale-${sale.id}`}>
                      <TableCell className="font-medium">#{sale.id}</TableCell>
                      <TableCell>{sale.saleDate ? new Date(sale.saleDate).toLocaleDateString() : "-"}</TableCell>
                      <TableCell className="font-bold">${sale.totalAmount}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{sale.paymentMethod}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
