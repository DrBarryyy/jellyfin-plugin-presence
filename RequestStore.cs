using Microsoft.Data.Sqlite;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.Presence;

public class MediaRequest
{
    public string Id { get; set; } = string.Empty;
    public string TmdbId { get; set; } = string.Empty;
    public string MediaType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Year { get; set; }
    public string? PosterPath { get; set; }
    public string? Overview { get; set; }
    public Guid UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public string? JellyfinItemId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? FulfilledAt { get; set; }
}

public class RequestStore : IDisposable
{
    private readonly string _dbPath;
    private readonly object _lock = new();

    public RequestStore(IApplicationPaths appPaths)
    {
        var pluginDataPath = Path.Combine(appPaths.PluginConfigurationsPath, "Presence");
        Directory.CreateDirectory(pluginDataPath);
        _dbPath = Path.Combine(pluginDataPath, "comments.db");
        InitializeDatabase();
    }

    private SqliteConnection CreateConnection()
    {
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    private void InitializeDatabase()
    {
        using var conn = CreateConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS Requests (
                Id TEXT PRIMARY KEY,
                TmdbId TEXT NOT NULL,
                MediaType TEXT NOT NULL,
                Title TEXT NOT NULL,
                Year TEXT,
                PosterPath TEXT,
                Overview TEXT,
                UserId TEXT NOT NULL,
                Username TEXT NOT NULL,
                Status TEXT NOT NULL DEFAULT 'pending',
                JellyfinItemId TEXT,
                CreatedAt TEXT NOT NULL,
                FulfilledAt TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_tmdb ON Requests(TmdbId);
            CREATE INDEX IF NOT EXISTS idx_requests_status ON Requests(Status);
        ";
        cmd.ExecuteNonQuery();
    }

    public List<MediaRequest> GetAll()
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, TmdbId, MediaType, Title, Year, PosterPath, Overview, UserId, Username, Status, JellyfinItemId, CreatedAt, FulfilledAt FROM Requests ORDER BY CreatedAt DESC";

            var requests = new List<MediaRequest>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                requests.Add(ReadRequest(reader));
            }

            return requests;
        }
    }

    public List<MediaRequest> GetPending()
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, TmdbId, MediaType, Title, Year, PosterPath, Overview, UserId, Username, Status, JellyfinItemId, CreatedAt, FulfilledAt FROM Requests WHERE Status = 'pending'";

            var requests = new List<MediaRequest>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                requests.Add(ReadRequest(reader));
            }

            return requests;
        }
    }

    public MediaRequest? GetByTmdbId(string tmdbId)
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, TmdbId, MediaType, Title, Year, PosterPath, Overview, UserId, Username, Status, JellyfinItemId, CreatedAt, FulfilledAt FROM Requests WHERE TmdbId = @tmdbId";
            cmd.Parameters.AddWithValue("@tmdbId", tmdbId);

            using var reader = cmd.ExecuteReader();
            if (reader.Read())
            {
                return ReadRequest(reader);
            }

            return null;
        }
    }

    public MediaRequest Add(string tmdbId, string mediaType, string title, string? year, string? posterPath, string? overview, Guid userId, string username)
    {
        var request = new MediaRequest
        {
            Id = Guid.NewGuid().ToString("N"),
            TmdbId = tmdbId,
            MediaType = mediaType,
            Title = title,
            Year = year,
            PosterPath = posterPath,
            Overview = overview,
            UserId = userId,
            Username = username,
            Status = "pending",
            CreatedAt = DateTime.UtcNow
        };

        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"INSERT INTO Requests (Id, TmdbId, MediaType, Title, Year, PosterPath, Overview, UserId, Username, Status, CreatedAt)
                VALUES (@id, @tmdbId, @mediaType, @title, @year, @posterPath, @overview, @userId, @username, @status, @createdAt)";
            cmd.Parameters.AddWithValue("@id", request.Id);
            cmd.Parameters.AddWithValue("@tmdbId", request.TmdbId);
            cmd.Parameters.AddWithValue("@mediaType", request.MediaType);
            cmd.Parameters.AddWithValue("@title", request.Title);
            cmd.Parameters.AddWithValue("@year", (object?)request.Year ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@posterPath", (object?)request.PosterPath ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@overview", (object?)request.Overview ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@userId", request.UserId.ToString());
            cmd.Parameters.AddWithValue("@username", request.Username);
            cmd.Parameters.AddWithValue("@status", request.Status);
            cmd.Parameters.AddWithValue("@createdAt", request.CreatedAt.ToString("O"));
            cmd.ExecuteNonQuery();
        }

        return request;
    }

    public bool Delete(string requestId, Guid userId)
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM Requests WHERE Id = @id AND UserId = @userId";
            cmd.Parameters.AddWithValue("@id", requestId);
            cmd.Parameters.AddWithValue("@userId", userId.ToString());
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public bool MarkAvailable(string tmdbId, string jellyfinItemId)
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE Requests SET Status = 'available', JellyfinItemId = @jellyfinItemId, FulfilledAt = @fulfilledAt WHERE TmdbId = @tmdbId AND Status = 'pending'";
            cmd.Parameters.AddWithValue("@tmdbId", tmdbId);
            cmd.Parameters.AddWithValue("@jellyfinItemId", jellyfinItemId);
            cmd.Parameters.AddWithValue("@fulfilledAt", DateTime.UtcNow.ToString("O"));
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    private static MediaRequest ReadRequest(SqliteDataReader reader)
    {
        return new MediaRequest
        {
            Id = reader.GetString(0),
            TmdbId = reader.GetString(1),
            MediaType = reader.GetString(2),
            Title = reader.GetString(3),
            Year = reader.IsDBNull(4) ? null : reader.GetString(4),
            PosterPath = reader.IsDBNull(5) ? null : reader.GetString(5),
            Overview = reader.IsDBNull(6) ? null : reader.GetString(6),
            UserId = Guid.Parse(reader.GetString(7)),
            Username = reader.GetString(8),
            Status = reader.GetString(9),
            JellyfinItemId = reader.IsDBNull(10) ? null : reader.GetString(10),
            CreatedAt = DateTime.Parse(reader.GetString(11)),
            FulfilledAt = reader.IsDBNull(12) ? null : DateTime.Parse(reader.GetString(12))
        };
    }

    public void Dispose()
    {
    }
}
