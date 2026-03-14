using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Presence;

[JsonConverter(typeof(JsonStringEnumConverter))]
public enum PresenceState
{
    Online,
    Idle,
    Offline
}

public class UserPresenceInfo
{
    public Guid UserId { get; set; }

    public string Username { get; set; } = string.Empty;

    public PresenceState State { get; set; }

    [JsonIgnore]
    public DateTime LastHeartbeat { get; set; }

    [JsonIgnore]
    public DateTime LastActive { get; set; }
}

public class HeartbeatRequest
{
    public bool IsActive { get; set; }
}
