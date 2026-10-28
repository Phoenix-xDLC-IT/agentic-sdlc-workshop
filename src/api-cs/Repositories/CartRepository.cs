using Microsoft.Data.Sqlite;
using OctoSupply.Api.Data;
using OctoSupply.Api.Models;
using OctoSupply.Api.Utils;

namespace OctoSupply.Api.Repositories;

public sealed class CartRepository(SqliteConnectionFactory connectionFactory)
{
    public const int MaxQuantity = 99;

    private readonly SqliteConnectionFactory _connectionFactory = connectionFactory;

    public async Task<Cart> GetAsync()
    {
        const string sql = """
            SELECT p.product_id, p.name, p.img_name, p.sku, p.unit, p.price,
                   COALESCE(p.discount, 0.0) AS discount, c.quantity
            FROM cart_items c
            JOIN products p ON p.product_id = c.product_id
            ORDER BY c.cart_item_id;
            """;
        await using var connection = await _connectionFactory.OpenConnectionAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        await using var reader = await cmd.ExecuteReaderAsync();
        var items = new List<CartItem>();
        while (await reader.ReadAsync())
        {
            items.Add(Map(reader));
        }

        return new Cart(items, items.Sum(i => i.Quantity), Round(items.Sum(i => i.LineTotal)));
    }

    public async Task<Cart> AddItemAsync(AddCartItemRequest request)
    {
        if (request.ProductId <= 0)
        {
            throw new ValidationException("productId is required");
        }
        ValidateQuantity(request.Quantity);

        await using var connection = await _connectionFactory.OpenConnectionAsync();
        await using (var exists = connection.CreateCommand())
        {
            exists.CommandText = "SELECT COUNT(*) FROM products WHERE product_id = $productId;";
            exists.Parameters.AddWithValue("$productId", request.ProductId);
            if (Convert.ToInt32(await exists.ExecuteScalarAsync()) == 0)
            {
                throw new NotFoundException("Product", request.ProductId);
            }
        }

        const string sql = """
            INSERT INTO cart_items (product_id, quantity)
            VALUES ($productId, $quantity)
            ON CONFLICT(product_id) DO UPDATE SET
                quantity = MIN(quantity + excluded.quantity, $max),
                updated_at = CURRENT_TIMESTAMP;
            """;
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$productId", request.ProductId);
        cmd.Parameters.AddWithValue("$quantity", request.Quantity);
        cmd.Parameters.AddWithValue("$max", MaxQuantity);
        await cmd.ExecuteNonQueryAsync();

        return await GetAsync();
    }

    public async Task<Cart> UpdateQuantityAsync(int productId, UpdateCartItemRequest request)
    {
        ValidateQuantity(request.Quantity);

        const string sql = """
            UPDATE cart_items SET quantity = $quantity, updated_at = CURRENT_TIMESTAMP
            WHERE product_id = $productId;
            """;
        await using var connection = await _connectionFactory.OpenConnectionAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$productId", productId);
        cmd.Parameters.AddWithValue("$quantity", request.Quantity);
        if (await cmd.ExecuteNonQueryAsync() == 0)
        {
            throw new NotFoundException("CartItem", productId);
        }

        return await GetAsync();
    }

    public async Task<Cart> RemoveItemAsync(int productId)
    {
        const string sql = "DELETE FROM cart_items WHERE product_id = $productId;";
        await using var connection = await _connectionFactory.OpenConnectionAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$productId", productId);
        if (await cmd.ExecuteNonQueryAsync() == 0)
        {
            throw new NotFoundException("CartItem", productId);
        }

        return await GetAsync();
    }

    public async Task ClearAsync()
    {
        await using var connection = await _connectionFactory.OpenConnectionAsync();
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = "DELETE FROM cart_items;";
        await cmd.ExecuteNonQueryAsync();
    }

    private static void ValidateQuantity(int quantity)
    {
        if (quantity < 1 || quantity > MaxQuantity)
        {
            throw new ValidationException($"quantity must be between 1 and {MaxQuantity}");
        }
    }

    private static double Round(double value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);

    private static CartItem Map(SqliteDataReader reader)
    {
        var price = reader.GetDouble(reader.GetOrdinal("price"));
        var discount = reader.GetDouble(reader.GetOrdinal("discount"));
        var quantity = reader.GetInt32(reader.GetOrdinal("quantity"));
        var unitPrice = Round(price * (1 - discount));
        return new CartItem(
            ProductId: reader.GetInt32(reader.GetOrdinal("product_id")),
            Name: reader.GetString(reader.GetOrdinal("name")),
            ImgName: reader["img_name"] as string,
            Sku: reader.GetString(reader.GetOrdinal("sku")),
            Unit: reader.GetString(reader.GetOrdinal("unit")),
            Price: price,
            Discount: discount,
            UnitPrice: unitPrice,
            Quantity: quantity,
            LineTotal: Round(unitPrice * quantity));
    }
}
