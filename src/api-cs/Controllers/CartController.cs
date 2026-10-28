using Microsoft.AspNetCore.Mvc;
using OctoSupply.Api.Models;
using OctoSupply.Api.Repositories;

namespace OctoSupply.Api.Controllers;

[ApiController]
[Route("api/cart")]
public sealed class CartController(CartRepository repository) : ControllerBase
{
    private readonly CartRepository _repository = repository;

    [HttpGet]
    public async Task<ActionResult<Cart>> Get() => Ok(await _repository.GetAsync());

    [HttpPost("items")]
    public async Task<ActionResult<Cart>> AddItem([FromBody] AddCartItemRequest request) =>
        Ok(await _repository.AddItemAsync(request));

    [HttpPut("items/{productId:int}")]
    public async Task<ActionResult<Cart>> UpdateItem(int productId, [FromBody] UpdateCartItemRequest request) =>
        Ok(await _repository.UpdateQuantityAsync(productId, request));

    [HttpDelete("items/{productId:int}")]
    public async Task<ActionResult<Cart>> RemoveItem(int productId) =>
        Ok(await _repository.RemoveItemAsync(productId));

    [HttpDelete]
    public async Task<IActionResult> Clear()
    {
        await _repository.ClearAsync();
        return NoContent();
    }
}
