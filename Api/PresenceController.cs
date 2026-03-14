using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Presence.Api;

[ApiController]
[Route("api/[controller]")]
public class PresenceController : ControllerBase
{
    [HttpPost("Heartbeat")]
    [Authorize]
    public ActionResult Heartbeat([FromBody] HeartbeatRequest request)
    {
        var manager = PresenceManager.Instance;
        if (manager == null)
        {
            return StatusCode(503);
        }

        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var username = User.FindFirst("Jellyfin-Username")?.Value
            ?? User.Identity?.Name
            ?? "Unknown";

        manager.Heartbeat(userId, username, request.IsActive);
        return Ok();
    }

    [HttpGet("Users")]
    [Authorize]
    public ActionResult<List<UserPresenceInfo>> GetUsers()
    {
        var manager = PresenceManager.Instance;
        if (manager == null)
        {
            return StatusCode(503);
        }

        return Ok(manager.GetAll());
    }

    [HttpGet("Events")]
    [Authorize]
    public async Task GetEvents(CancellationToken cancellationToken)
    {
        var manager = PresenceManager.Instance;
        if (manager == null)
        {
            Response.StatusCode = 503;
            return;
        }

        Response.Headers.ContentType = "text/event-stream";
        Response.Headers.CacheControl = "no-cache";
        Response.Headers["X-Accel-Buffering"] = "no";

        // Send initial state immediately
        var initial = JsonSerializer.Serialize(manager.GetAll());
        await Response.WriteAsync($"data: {initial}\n\n", cancellationToken);
        await Response.Body.FlushAsync(cancellationToken);

        var (reader, writer) = manager.Subscribe();
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
            manager.Unsubscribe(writer);
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
}
