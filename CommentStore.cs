using Microsoft.Data.Sqlite;
using MediaBrowser.Common.Configuration;

namespace Jellyfin.Plugin.Presence;

public class Comment
{
    public string Id { get; set; } = string.Empty;
    public string MediaId { get; set; } = string.Empty;
    public Guid UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public long PositionTicks { get; set; }
    public string Text { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}

public class CommentStore : IDisposable
{
    private readonly string _dbPath;
    private readonly object _lock = new();

    public CommentStore(IApplicationPaths appPaths)
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
            CREATE TABLE IF NOT EXISTS Comments (
                Id TEXT PRIMARY KEY,
                MediaId TEXT NOT NULL,
                UserId TEXT NOT NULL,
                Username TEXT NOT NULL,
                PositionTicks INTEGER NOT NULL,
                Text TEXT NOT NULL,
                CreatedAt TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_comments_media ON Comments(MediaId);
        ";
        cmd.ExecuteNonQuery();
    }

    public List<Comment> GetComments(string mediaId)
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT Id, MediaId, UserId, Username, PositionTicks, Text, CreatedAt FROM Comments WHERE MediaId = @mediaId ORDER BY PositionTicks ASC";
            cmd.Parameters.AddWithValue("@mediaId", mediaId);

            var comments = new List<Comment>();
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                comments.Add(new Comment
                {
                    Id = reader.GetString(0),
                    MediaId = reader.GetString(1),
                    UserId = Guid.Parse(reader.GetString(2)),
                    Username = reader.GetString(3),
                    PositionTicks = reader.GetInt64(4),
                    Text = reader.GetString(5),
                    CreatedAt = DateTime.Parse(reader.GetString(6))
                });
            }

            return comments;
        }
    }

    public Comment AddComment(string mediaId, Guid userId, string username, long positionTicks, string text)
    {
        var comment = new Comment
        {
            Id = Guid.NewGuid().ToString("N"),
            MediaId = mediaId,
            UserId = userId,
            Username = username,
            PositionTicks = positionTicks,
            Text = text,
            CreatedAt = DateTime.UtcNow
        };

        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "INSERT INTO Comments (Id, MediaId, UserId, Username, PositionTicks, Text, CreatedAt) VALUES (@id, @mediaId, @userId, @username, @positionTicks, @text, @createdAt)";
            cmd.Parameters.AddWithValue("@id", comment.Id);
            cmd.Parameters.AddWithValue("@mediaId", comment.MediaId);
            cmd.Parameters.AddWithValue("@userId", comment.UserId.ToString());
            cmd.Parameters.AddWithValue("@username", comment.Username);
            cmd.Parameters.AddWithValue("@positionTicks", comment.PositionTicks);
            cmd.Parameters.AddWithValue("@text", comment.Text);
            cmd.Parameters.AddWithValue("@createdAt", comment.CreatedAt.ToString("O"));
            cmd.ExecuteNonQuery();
        }

        return comment;
    }

    public bool DeleteComment(string commentId, Guid userId)
    {
        lock (_lock)
        {
            using var conn = CreateConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM Comments WHERE Id = @id AND UserId = @userId";
            cmd.Parameters.AddWithValue("@id", commentId);
            cmd.Parameters.AddWithValue("@userId", userId.ToString());
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public void Dispose()
    {
    }
}
