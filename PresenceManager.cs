using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Channels;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.Presence;

public class PresenceManager : IDisposable
{
    private static readonly TimeSpan OfflineTimeout = TimeSpan.FromSeconds(30);

    private readonly ConcurrentDictionary<Guid, UserPresenceInfo> _presenceMap = new();
    private readonly List<ChannelWriter<string>> _subscribers = new();
    private readonly object _subLock = new();
    private readonly IUserManager _userManager;
    private Timer? _cleanupTimer;

    public static PresenceManager? Instance { get; private set; }

    public PresenceManager(IUserManager userManager)
    {
        _userManager = userManager;
        Instance = this;
    }

    public void Start()
    {
        foreach (var user in _userManager.Users)
        {
            _presenceMap.TryAdd(user.Id, new UserPresenceInfo
            {
                UserId = user.Id,
                Username = user.Username,
                State = PresenceState.Offline
            });
        }

        _cleanupTimer = new Timer(CheckTimeouts, null, TimeSpan.FromSeconds(5), TimeSpan.FromSeconds(5));
    }

    public void Heartbeat(Guid userId, string username, bool isActive)
    {
        var now = DateTime.UtcNow;
        var newState = isActive ? PresenceState.Online : PresenceState.Idle;

        _presenceMap.AddOrUpdate(
            userId,
            _ => new UserPresenceInfo
            {
                UserId = userId,
                Username = username,
                State = newState,
                LastHeartbeat = now,
                LastActive = isActive ? now : DateTime.MinValue
            },
            (_, existing) =>
            {
                var oldState = existing.State;
                existing.LastHeartbeat = now;
                existing.State = newState;
                existing.Username = username;
                if (isActive)
                {
                    existing.LastActive = now;
                }

                return existing;
            });

        Broadcast();
    }

    public List<UserPresenceInfo> GetAll()
    {
        return _presenceMap.Values
            .OrderBy(u => u.State)
            .ThenBy(u => u.Username)
            .ToList();
    }

    public (ChannelReader<string> Reader, ChannelWriter<string> Writer) Subscribe()
    {
        var channel = Channel.CreateBounded<string>(new BoundedChannelOptions(10)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        });

        lock (_subLock)
        {
            _subscribers.Add(channel.Writer);
        }

        return (channel.Reader, channel.Writer);
    }

    public void Unsubscribe(ChannelWriter<string> writer)
    {
        lock (_subLock)
        {
            _subscribers.Remove(writer);
        }

        writer.TryComplete();
    }

    private void Broadcast()
    {
        var json = JsonSerializer.Serialize(GetAll());

        lock (_subLock)
        {
            var dead = new List<ChannelWriter<string>>();
            foreach (var writer in _subscribers)
            {
                if (!writer.TryWrite(json))
                {
                    dead.Add(writer);
                }
            }

            foreach (var d in dead)
            {
                _subscribers.Remove(d);
                d.TryComplete();
            }
        }
    }

    private void CheckTimeouts(object? state)
    {
        var now = DateTime.UtcNow;
        bool changed = false;

        foreach (var kvp in _presenceMap)
        {
            var info = kvp.Value;
            if (info.State == PresenceState.Offline)
            {
                continue;
            }

            if (now - info.LastHeartbeat > OfflineTimeout)
            {
                info.State = PresenceState.Offline;
                changed = true;
            }
        }

        if (changed)
        {
            Broadcast();
        }
    }

    public void Dispose()
    {
        _cleanupTimer?.Dispose();
        lock (_subLock)
        {
            foreach (var w in _subscribers)
            {
                w.TryComplete();
            }

            _subscribers.Clear();
        }
    }
}
