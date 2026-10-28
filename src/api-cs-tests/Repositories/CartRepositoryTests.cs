using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using OctoSupply.Api.Data;
using OctoSupply.Api.Models;
using OctoSupply.Api.Repositories;
using OctoSupply.Api.Utils;
using Xunit;

namespace OctoSupply.Api.Tests.Repositories;

[Collection("EnvDb")]
public sealed class CartRepositoryTests : IDisposable
{
    private readonly string _dbFile = Path.Combine(Path.GetTempPath(), $"cart-test-{Guid.NewGuid():N}.db");
    private readonly SqliteConnectionFactory _factory;
    private readonly CartRepository _repository;

    public CartRepositoryTests()
    {
        Environment.SetEnvironmentVariable("DB_FILE", _dbFile);
        Environment.SetEnvironmentVariable("DB_MIGRATIONS_DIR", FindMigrationsDir());
        _factory = new SqliteConnectionFactory(NullLogger<SqliteConnectionFactory>.Instance);
        new DatabaseMigrator(_factory, NullLogger<DatabaseMigrator>.Instance).InitializeAsync(seedOnStartup: false).GetAwaiter().GetResult();
        Exec("INSERT INTO suppliers (supplier_id, name) VALUES (1, 'S');");
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (1, 1, 'Plain', 10.00, 'P1', 'ea', 0.0);");
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (2, 1, 'Discounted', 19.99, 'P2', 'ea', 0.15);");
        _repository = new CartRepository(_factory);
    }

    [Fact]
    public async Task Empty_cart_has_zero_totals()
    {
        var cart = await _repository.GetAsync();
        Assert.Empty(cart.Items);
        Assert.Equal(0, cart.ItemCount);
        Assert.Equal(0, cart.Subtotal);
    }

    [Fact]
    public async Task Add_same_product_increments_quantity()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 2 });
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 3 });
        var item = Assert.Single(cart.Items);
        Assert.Equal(5, item.Quantity);
        Assert.Equal(50.00, cart.Subtotal);
    }

    [Fact]
    public async Task Add_caps_quantity_at_maximum()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 90 });
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 50 });
        Assert.Equal(CartRepository.MaxQuantity, Assert.Single(cart.Items).Quantity);
    }

    [Fact]
    public async Task Totals_apply_discount_and_round_per_line()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 });
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 2, Quantity = 3 });
        var discounted = cart.Items.Single(i => i.ProductId == 2);
        Assert.Equal(16.99, discounted.UnitPrice);
        Assert.Equal(50.97, discounted.LineTotal);
        Assert.Equal(60.97, cart.Subtotal);
        Assert.Equal(4, cart.ItemCount);
    }

    [Fact]
    public async Task Update_sets_absolute_quantity_and_recomputes_totals()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 2 });
        var cart = await _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = 7 });
        Assert.Equal(7, Assert.Single(cart.Items).Quantity);
        Assert.Equal(70.00, cart.Subtotal);
    }

    [Fact]
    public async Task Remove_deletes_line()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 2 });
        var cart = await _repository.RemoveItemAsync(1);
        Assert.Empty(cart.Items);
        Assert.Equal(0, cart.Subtotal);
    }

    [Fact]
    public async Task Cart_persists_across_repository_instances()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 2, Quantity = 1 });
        var cart = await new CartRepository(_factory).GetAsync();
        Assert.Single(cart.Items);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(100)]
    public async Task Invalid_quantity_is_rejected(int quantity)
    {
        await Assert.ThrowsAsync<ValidationException>(() =>
            _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = quantity }));
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 });
        await Assert.ThrowsAsync<ValidationException>(() =>
            _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = quantity }));
    }

    [Fact]
    public async Task Unknown_product_or_line_returns_not_found()
    {
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _repository.AddItemAsync(new AddCartItemRequest { ProductId = 999, Quantity = 1 }));
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = 1 }));
        await Assert.ThrowsAsync<NotFoundException>(() => _repository.RemoveItemAsync(1));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(CartRepository.MaxQuantity)]
    public async Task Boundary_quantities_are_accepted(int quantity)
    {
        var added = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = quantity });
        Assert.Equal(quantity, Assert.Single(added.Items).Quantity);
        var updated = await _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = quantity });
        Assert.Equal(quantity, Assert.Single(updated.Items).Quantity);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public async Task Add_with_non_positive_product_id_is_rejected(int productId)
    {
        await Assert.ThrowsAsync<ValidationException>(() =>
            _repository.AddItemAsync(new AddCartItemRequest { ProductId = productId, Quantity = 1 }));
    }

    [Fact]
    public async Task Rejected_requests_do_not_change_the_cart()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 2 });
        await Assert.ThrowsAsync<ValidationException>(() =>
            _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = 100 }));
        await Assert.ThrowsAsync<NotFoundException>(() =>
            _repository.AddItemAsync(new AddCartItemRequest { ProductId = 999, Quantity = 1 }));
        var cart = await _repository.GetAsync();
        Assert.Equal(2, Assert.Single(cart.Items).Quantity);
    }

    [Fact]
    public async Task Update_and_remove_only_affect_the_target_line()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 2 });
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 2, Quantity = 1 });

        var updated = await _repository.UpdateQuantityAsync(1, new UpdateCartItemRequest { Quantity = 4 });
        Assert.Equal(1, updated.Items.Single(i => i.ProductId == 2).Quantity);
        Assert.Equal([1, 2], updated.Items.Select(i => i.ProductId));

        var removed = await _repository.RemoveItemAsync(1);
        var remaining = Assert.Single(removed.Items);
        Assert.Equal(2, remaining.ProductId);
        Assert.Equal(remaining.LineTotal, removed.Subtotal);
    }

    [Fact]
    public async Task Removing_the_same_line_twice_returns_not_found()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 });
        await _repository.RemoveItemAsync(1);
        await Assert.ThrowsAsync<NotFoundException>(() => _repository.RemoveItemAsync(1));
    }

    [Fact]
    public async Task Clear_removes_all_lines_and_is_idempotent()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 });
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 2, Quantity = 1 });
        await _repository.ClearAsync();
        await _repository.ClearAsync();
        var cart = await _repository.GetAsync();
        Assert.Empty(cart.Items);
        Assert.Equal(0, cart.Subtotal);
    }

    [Fact]
    public async Task Null_discount_is_treated_as_no_discount()
    {
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (3, 1, 'NoDiscount', 4.50, 'P3', 'ea', NULL);");
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 3, Quantity = 2 });
        var item = Assert.Single(cart.Items);
        Assert.Equal(0, item.Discount);
        Assert.Equal(9.00, item.LineTotal);
    }

    [Fact]
    public async Task Full_discount_yields_a_zero_total()
    {
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (4, 1, 'Free', 12.00, 'P4', 'ea', 1.0);");
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 4, Quantity = 5 });
        Assert.Equal(0, cart.Subtotal);
    }

    [Fact]
    public async Task Midpoint_unit_price_rounds_away_from_zero()
    {
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (5, 1, 'Midpoint', 0.25, 'P5', 'ea', 0.5);");
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 5, Quantity = 1 });
        Assert.Equal(0.13, Assert.Single(cart.Items).UnitPrice);
    }

    [Fact]
    public async Task Subtotal_does_not_leak_floating_point_error()
    {
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (6, 1, 'Dime', 0.10, 'P6', 'ea', 0.0);");
        Exec("INSERT INTO products (product_id, supplier_id, name, price, sku, unit, discount) VALUES (7, 1, 'Fifth', 0.20, 'P7', 'ea', 0.0);");
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 6, Quantity = 1 });
        var cart = await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 7, Quantity = 1 });
        Assert.Equal(0.30, cart.Subtotal);
    }

    [Fact]
    public async Task Deleting_a_product_removes_it_from_the_cart()
    {
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 });
        await _repository.AddItemAsync(new AddCartItemRequest { ProductId = 2, Quantity = 1 });
        Exec("DELETE FROM products WHERE product_id = 1;");
        var cart = await _repository.GetAsync();
        Assert.Equal(2, Assert.Single(cart.Items).ProductId);
    }

    [Theory]
    [InlineData("INSERT INTO cart_items (product_id, quantity) VALUES (1, 0);")]
    [InlineData("INSERT INTO cart_items (product_id, quantity) VALUES (1, 100);")]
    [InlineData("INSERT INTO cart_items (product_id, quantity) VALUES (999, 1);")]
    public void Database_constraints_reject_invalid_rows(string sql)
    {
        Assert.ThrowsAny<SqliteException>(() => Exec(sql));
    }

    [Fact]
    public void Database_allows_one_row_per_product()
    {
        Exec("INSERT INTO cart_items (product_id, quantity) VALUES (1, 1);");
        Assert.ThrowsAny<SqliteException>(() => Exec("INSERT INTO cart_items (product_id, quantity) VALUES (1, 1);"));
    }

    [Fact]
    public async Task Concurrent_adds_are_not_lost()
    {
        await Task.WhenAll(Enumerable.Range(0, 10).Select(_ =>
            _repository.AddItemAsync(new AddCartItemRequest { ProductId = 1, Quantity = 1 })));
        var cart = await _repository.GetAsync();
        Assert.Equal(10, Assert.Single(cart.Items).Quantity);
    }

    private void Exec(string sql)
    {
        using var connection = _factory.OpenConnectionAsync().GetAwaiter().GetResult();
        using var cmd = connection.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static string FindMigrationsDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "database", "migrations");
            if (Directory.Exists(candidate))
            {
                return candidate;
            }
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("database/migrations not found");
    }

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_dbFile + suffix); } catch (IOException) { }
        }
    }
}
