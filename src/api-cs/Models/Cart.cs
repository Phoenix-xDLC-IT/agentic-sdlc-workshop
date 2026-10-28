namespace OctoSupply.Api.Models;

public sealed record CartItem(
    int ProductId,
    string Name,
    string? ImgName,
    string Sku,
    string Unit,
    double Price,
    double Discount,
    double UnitPrice,
    int Quantity,
    double LineTotal);

public sealed record Cart(
    IReadOnlyList<CartItem> Items,
    int ItemCount,
    double Subtotal);

public sealed class AddCartItemRequest
{
    public int ProductId { get; set; }
    public int Quantity { get; set; }
}

public sealed class UpdateCartItemRequest
{
    public int Quantity { get; set; }
}
