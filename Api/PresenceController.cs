using System.Reflection;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Presence.Api;

[ApiController]
[Route("api/[controller]")]
public class PresenceController : ControllerBase
{
    private readonly PresenceManager _manager;

    public PresenceController(PresenceManager manager)
    {
        _manager = manager;
    }

    [HttpPost("Heartbeat")]
    [Authorize]
    public ActionResult Heartbeat([FromBody] HeartbeatRequest request)
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var username = User.FindFirst("Jellyfin-Username")?.Value
            ?? User.Identity?.Name
            ?? "Unknown";

        _manager.Heartbeat(userId, username, request.IsActive);
        return Ok();
    }

    [HttpPost("Dnd")]
    [Authorize]
    public ActionResult SetDnd([FromBody] SetDndRequest request)
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        _manager.SetDnd(userId, request.Enabled);
        return Ok();
    }

    [HttpGet("Users")]
    [Authorize]
    public ActionResult<List<UserPresenceInfo>> GetUsers()
    {
        return Ok(_manager.GetAll());
    }

    [HttpGet("Events")]
    [Authorize]
    public async Task GetEvents(CancellationToken cancellationToken)
    {
        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";

        var initial = JsonSerializer.Serialize(_manager.GetAll());
        await Response.WriteAsync($"data: {initial}\n\n", cancellationToken);
        await Response.Body.FlushAsync(cancellationToken);

        var (reader, writer) = _manager.Subscribe();
        try
        {
            await foreach (var data in reader.ReadAllAsync(cancellationToken))
            {
                await Response.WriteAsync($"data: {data}\n\n", cancellationToken);
                await Response.Body.FlushAsync(cancellationToken);
            }
        }
        finally
        {
            _manager.Unsubscribe(writer);
        }
    }

    [HttpGet("Script")]
    [AllowAnonymous]
    public ActionResult GetScript()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var stream = assembly.GetManifestResourceStream("Jellyfin.Plugin.Presence.Web.presence.js");
        if (stream == null)
        {
            return NotFound();
        }

        return File(stream, "application/javascript");
    }

    [HttpGet("CommentsScript")]
    [AllowAnonymous]
    public ActionResult GetCommentsScript()
    {
        var assembly = Assembly.GetExecutingAssembly();
        var stream = assembly.GetManifestResourceStream("Jellyfin.Plugin.Presence.Web.comments.js");
        if (stream == null)
        {
            return NotFound();
        }

        return File(stream, "application/javascript");
    }
}
