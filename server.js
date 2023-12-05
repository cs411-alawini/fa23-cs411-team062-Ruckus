var express = require('express');
var bodyParser = require('body-parser');
var mysql = require('mysql2');
var path = require('path');
var searchKeyword = "";
const bcrypt = require('bcrypt');
const SpotifyWebApi = require('spotify-web-api-node');
const session = require('express-session');
const { count } = require('console');
require('dotenv').config();

function CustomSearchSelectionsMode() {
  this.tempo = "false";
  this.valence = "false";
  this.liveness = "false";
  this.instrumentalness = "false";
  this.acousticness = "false";
  this.speechiness = "false";
  this.mode = "false";
  this.musickey = "false";
  this.energy = "false";
  this.danceability = "false";
  this.duration = "false";
  this.popularity = "false";
  this.tolerance = 10;
}

const cssm = new CustomSearchSelectionsMode();

var connection = mysql.createConnection({
  host: '35.226.135.62',
  user: 'root',
  password: 'Ruckus2023!',
  database: 'db'
});

connection.connect(function (err) {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('Connected to database');
});

var app = express();
app.use(session({
  secret: process.env.my_secret_key,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 60000 }
}));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(__dirname + '../public'));

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
  redirectUri: process.env.SPOTIFY_REDIRECT_URI
});
async function handleRateLimit(func, ...args) {
  try {
    return await func(...args);
  } catch (error) {
    
    if (error instanceof SpotifyWebApi.WebapiError && error.statusCode === 429) {
      const retryAfter = error.headers['retry-after'];
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(handleRateLimit(func, ...args));
        }, retryAfter * 1000);
      });
    } else {
      throw error;
    }
  }
}
/* GET home page, respond by rendering index.ejs */
app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

app.get('/success', function (req, res) {
  res.send({ 'message': 'Attendance marked successfully!' });
});

app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { email, username, password, name } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);

  const sql = 'INSERT INTO User (email, userid, hashedpassword, name) VALUES (?, ?, ?, ?)';
  connection.execute(sql, [email, username, hashedPassword, name], (err) => {
    if (err) {
      return res.send('Failed to register');
    }
    res.redirect('/login');
  });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const sql = 'SELECT * FROM User WHERE UserId = ?';
  
  connection.execute(sql, [username], async (err, results) => {
    
    if (err || results.length === 0 || !(await bcrypt.compare(password, results[0].HashedPassword))) {
      return res.send('Failed to login');
    }
    req.session.user = username;
    res.redirect('/profile');
  });
});

app.get('/profile', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const sql = 'SELECT * FROM User WHERE UserID = ?';
    const [userResults] = await connection.promise().execute(sql, [req.session.user]);
    if (userResults.length === 0) {
      return res.send('User not found');
    }
    const user = userResults[0];
    const spotifySql = 'SELECT SpotifyProfile.* FROM LinkedProfile JOIN SpotifyProfile ON LinkedProfile.SpotifyProfileID = SpotifyProfile.UserID WHERE LinkedProfile.UserID = ?';
    const [spotifyResults] = await connection.promise().execute(spotifySql, [req.session.user]);
    const spotifyProfile = spotifyResults[0] || null;

    res.render('profile', { user, spotifyProfile });
  } catch (err) {
    console.error('Failed to fetch profile', err);
    res.send('An error occurred');
  }
});


app.get('/spotify', (req, res) => {

  authorizeURL = spotifyApi.createAuthorizeURL(['user-read-private', 'user-top-read' ,'playlist-read-private', 'user-read-email', 'user-library-read', 'playlist-read-collaborative'], null);
  res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await handleRateLimit(() => spotifyApi.authorizationCodeGrant(code));
    const { access_token, refresh_token } = data.body;
    handleRateLimit(() => spotifyApi.setAccessToken(access_token));
    handleRateLimit(() => spotifyApi.setRefreshToken(refresh_token));


    // Fetch Spotify user's profile
    const spotifyUserData = await handleRateLimit(() => spotifyApi.getMe());

    const { id, display_name, external_urls, images } = spotifyUserData.body;

    // Save to SpotifyProfile table
    const checkQuery = 'SELECT 1 FROM SpotifyProfile WHERE UserID = ?';
    const [rows] = await connection.promise().query(checkQuery, [id]);
    if (rows.length === 0) {
      const insertSpotifyProfile = 'INSERT IGNORE INTO SpotifyProfile(UserID, DisplayName, ProfileUrl, ImageUrl, APIKey, access) VALUES (?, ?, ?, ?, ?, ?)';
      await connection.promise().execute(insertSpotifyProfile, [
        id,
        display_name,
        external_urls.spotify,
        images[0]?.url || null,
        refresh_token,
        access_token
      ]);
    }
    // Save to LinkedProfile table
    const user = req.session.user; // Make sure the user is saved in session when the user logs in
    if (user) {
      const insertLinkedProfile = 'INSERT INTO LinkedProfile(UserID, SpotifyProfileID) VALUES (?, ?)';
      await connection.promise().execute(insertLinkedProfile, [user, id]);
    }

    res.redirect('/profile');
  } catch (err) {
    console.error('Something went wrong!', err);
    res.send('Failed to authenticate with Spotify');
  }
});
app.get('/removeAccount', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const sql = 'DELETE FROM LinkedProfile WHERE UserID = ?';
    const [userResults] = await connection.promise().execute(sql, [req.session.user]);
    res.redirect('/profile');
  } catch (err) {
    console.error('Failed to fetch profile', err);
    res.send('An error occurred');
  }
});

app.get('/liked-songs', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  try {


    const tracksQuery = `
        SELECT *
        FROM Track t
        JOIN UserLikes ul ON ul.TrackID = t.TrackID
        WHERE ul.UserID = ?;
      `;
    const [tracks] = await connection.promise().execute(tracksQuery, [req.session.user]);

    res.render('liked-songs', { likedSongs: tracks });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Keyword search page
app.get('/search', async(req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  try {
    const tracksQuery = `
      SELECT *
      FROM Track t
      WHERE 
        LOWER(t.Track_name) LIKE LOWER(?)
        OR LOWER(t.Album_name) LIKE LOWER(?);
    `;
    const [tracks] = await connection.promise().execute(tracksQuery, ['%' + searchKeyword + '%', '%' + searchKeyword + '%'], [req.session.user]);
    // console.log(tracks.length);
    // console.log(tracks[0]);

    res.render('search', { likedSongs: tracks, matchedTracks: [], keyword: searchKeyword, cssm: cssm});
  }
  catch(error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Search functionality
app.post('/search', async(req, res) => {
  const { textField } = req.body;
  try {
    const searchQuery = `
      SELECT *
      FROM Track t
      WHERE 
        LOWER(t.Track_name) LIKE LOWER(?)
        OR LOWER(t.Album_name) LIKE LOWER(?);
    `;
    const [tracks] = await connection.promise().execute(searchQuery, ['%' + textField + '%', '%' + textField + '%'], [req.session.user]);

    searchKeyword = textField;
    res.render('search', { likedSongs: tracks, matchedTracks: [], keyword: textField, cssm: cssm });
  }
  catch(error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Generic match functionality
app.post('/generic_match', async(req, res) => {
  const { textField } = req.body;
  try {
    const searchQuery = `
      SELECT *
      FROM Track t
      WHERE 
        LOWER(t.Track_name) LIKE LOWER(?)
        OR LOWER(t.Album_name) LIKE LOWER(?)
      LIMIT 1;
    `;

    const matchQuery = `
      SELECT *
      FROM Track
      WHERE
        (Tempo >= ? AND Tempo <= ?)
        AND (Valence >= ? AND Valence <= ?)
        AND (Liveness >= ? AND Liveness <= ?)
        AND (Instrumentalness >= ? AND Instrumentalness <= ?)
        AND (Acousticness >= ? AND Acousticness <= ?)
        AND (Speechiness >= ? AND Speechiness <= ?)
        AND (Mode >= ? AND Mode <= ?)
        AND (MusicKey >= ? and MusicKey <= ?)
        AND (Energy >= ? AND Energy <= ?)
        AND (Danceability >= ? AND Danceability <= ?)
        AND (Duration_ms >= ? AND Duration_ms <= ?)
        AND (Popularity >= ? AND Popularity <= ?);
    `;
    const [searchedTracks] = await connection.promise().execute(searchQuery, ['%' + searchKeyword + '%', '%' + searchKeyword + '%'], [req.session.user]);
    let track = searchedTracks[0];
    const matchArgs =
        [
          track.Tempo * 0.9, track.Tempo * 1.1,
          track.Valence * 0.9, track.Valence * 1.1,
          track.Liveness * 0.9, track.Liveness * 1.1,
          track.Instrumentalness * 0.9, track.Instrumentalness * 1.1,
          track.Acousticness * 0.9, track.Acousticness * 1.1,
          track.Speechiness * 0.9, track.Speechiness * 1.1,
          track.Mode * 0.9, track.Mode * 1.1,
          track.MusicKey * 0.9, track.MusicKey * 1.1,
          track.Energy * 0.9, track.Energy * 1.1,
          track.Danceability * 0.9, track.Danceability * 1.1,
          track.Duration_ms * 0.9, track.Duration_ms * 1.1,
          track.Popularity * 0.9, track.Popularity * 1.1
        ];
    var [matched_tracks] = await connection.promise().execute(matchQuery, matchArgs, [req.session.user]);

    res.render('search', { likedSongs: searchedTracks, matchedTracks: matched_tracks, keyword: searchKeyword, cssm: cssm });
  }
  catch(error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

// Custom match functionality
app.post('/custom_match', async(req, res) => {
  const { tempo,
          valence,
          liveness,
          instrumentalness,
          acousticness,
          speechiness,
          mode,
          musickey,
          energy,
          danceability,
          duration,
          popularity,
          tolerance } = req.body;
  try {
    const searchQuery = `
      SELECT *
      FROM Track t
      WHERE 
        LOWER(t.Track_name) LIKE LOWER(?)
        OR LOWER(t.Album_name) LIKE LOWER(?)
    `;

    const matchQuery = `
      SELECT *
      FROM Track
      WHERE
        (Tempo >= ? AND Tempo <= ?)
        AND (Valence >= ? AND Valence <= ?)
        AND (Liveness >= ? AND Liveness <= ?)
        AND (Instrumentalness >= ? AND Instrumentalness <= ?)
        AND (Acousticness >= ? AND Acousticness <= ?)
        AND (Speechiness >= ? AND Speechiness <= ?)
        AND (Mode >= ? AND Mode <= ?)
        AND (MusicKey >= ? and MusicKey <= ?)
        AND (Energy >= ? AND Energy <= ?)
        AND (Danceability >= ? AND Danceability <= ?)
        AND (Duration_ms >= ? AND Duration_ms <= ?)
        AND (Popularity >= ? AND Popularity <= ?);
    `;
    const [searchedTracks] = await connection.promise().execute(searchQuery, ['%' + searchKeyword + '%', '%' + searchKeyword + '%'], [req.session.user]);
    let track = searchedTracks[0];
    const matchArgs =
        [
          typeof tempo == "undefined" ? 0 : track.Tempo * (1 - tolerance / 100), 
          typeof tempo == "undefined" ? Number.MAX_SAFE_INTEGER : track.Tempo * (1 + tolerance / 100),
          typeof valence == "undefined" ? 0 : track.Valence * (1 - tolerance / 100), 
          typeof valence == "undefined" ? Number.MAX_SAFE_INTEGER : track.Valence * (1 + tolerance / 100),
          typeof liveness == "undefined" ? 0 : track.Liveness * (1 - tolerance / 100), 
          typeof liveness == "undefined" ? Number.MAX_SAFE_INTEGER : track.Liveness * (1 + tolerance / 100),
          typeof instrumentalness == "undefined" ? 0 : track.Instrumentalness * (1 - tolerance / 100), 
          typeof instrumentalness == "undefined" ? Number.MAX_SAFE_INTEGER : track.Instrumentalness * (1 + tolerance / 100),
          typeof acousticness == "undefined" ? 0 : track.Acousticness * (1 - tolerance / 100), 
          typeof acousticness == "undefined" ? Number.MAX_SAFE_INTEGER : track.Acousticness * (1 + tolerance / 100),
          typeof speechiness == "undefined" ? 0 : track.Speechiness * (1 - tolerance / 100), 
          typeof speechiness == "undefined" ? Number.MAX_SAFE_INTEGER : track.Speechiness * (1 + tolerance / 100),
          typeof mode == "undefined" ? 0 : track.Mode * (1 - tolerance / 100), 
          typeof mode == "undefined" ? Number.MAX_SAFE_INTEGER : track.Mode * (1 + tolerance / 100),
          typeof musickey == "undefined" ? 0 : track.MusicKey * (1 - tolerance / 100), 
          typeof musickey == "undefined" ? Number.MAX_SAFE_INTEGER : track.MusicKey * (1 + tolerance / 100),
          typeof energy == "undefined" ? 0 : track.Energy * (1 - tolerance / 100), 
          typeof energy == "undefined" ? Number.MAX_SAFE_INTEGER : track.Energy * (1 + tolerance / 100),
          typeof danceability == "undefined" ? 0 : track.Danceability * (1 - tolerance / 100), 
          typeof danceability == "undefined" ? Number.MAX_SAFE_INTEGER : track.Danceability * (1 + tolerance / 100),
          typeof duration == "undefined" ? 0 : track.Duration_ms * (1 - tolerance / 100), 
          typeof duration == "undefined" ? Number.MAX_SAFE_INTEGER : track.Duration_ms * (1 + tolerance / 100),
          typeof popularity == "undefined" ? 0 : track.Popularity * (1 - tolerance / 100), 
          typeof popularity == "undefined" ? Number.MAX_SAFE_INTEGER : track.Popularity * (1 + tolerance / 100)
        ];
    cssm.tempo = typeof tempo == "undefined" ? "false" : "true";
    cssm.valence = typeof valence == "undefined" ? "false" : "true";
    cssm.liveness = typeof liveness == "undefined" ? "false" : "true";
    cssm.instrumentalness = typeof instrumentalness == "undefined" ? "false" : "true";
    cssm.acousticness = typeof acousticness == "undefined" ? "false" : "true";
    cssm.speechiness = typeof speechiness == "undefined" ? "false" : "true";
    cssm.mode = typeof mode == "undefined" ? "false" : "true";
    cssm.musickey = typeof musickey == "undefined" ? "false" : "true";
    cssm.energy = typeof energy == "undefined" ? "false" : "true";
    cssm.danceability = typeof danceability == "undefined" ? "false" : "true";
    cssm.duration = typeof duration == "undefined" ? "false" : "true";
    cssm.popularity = typeof popularity == "undefined" ? "false" : "true";
    cssm.tolerance = tolerance;
    var [matched_tracks] = await connection.promise().execute(matchQuery, matchArgs, [req.session.user]);
    res.render('search', { likedSongs: searchedTracks, matchedTracks: matched_tracks, keyword: searchKeyword, cssm: cssm });
  }
  catch(error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/refresh', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  try {
    const userSpotifyDetailsQuery = `
        SELECT sp.APIKey, sp.access
        FROM User u
        JOIN LinkedProfile lp ON u.UserID = lp.UserID
        JOIN SpotifyProfile sp ON lp.SpotifyProfileID = sp.UserID
        WHERE u.UserID = ?;
    `;
    const [userSpotifyDetails] = await connection.promise().execute(userSpotifyDetailsQuery, [req.session.user]);
    handleRateLimit(() => spotifyApi.setRefreshToken(userSpotifyDetails[0].APIKey));
    const dat = await handleRateLimit(() => spotifyApi.refreshAccessToken());
    handleRateLimit(() => spotifyApi.setAccessToken(dat.body['access_token']));

    connection.execute('DELETE FROM Top_Saved_Track WHERE UserID = ?', [req.session.user]);
    connection.execute('DELETE FROM UserLikes WHERE UserID = ?', [req.session.user]);
    connection.execute('DELETE FROM UserPlaylist WHERE UserID = ?', [req.session.user]);
    
    let allPlaylists = [];
    let offset = 0;
    
    // Fetch all playlists
    flag2 = 1;
    while (flag2) {
      const playlists = await handleRateLimit(() => spotifyApi.getUserPlaylists({ limit: 50, offset: offset }));
      
      if (playlists == null || playlists.body.items.length === 0) {
        flag2 = 0;
        break;
      }

      for (const playlist of playlists.body.items) {
        // Insert playlist into database
        const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\p{Emoji}]/gu;
        playlist.name = await playlist.name.replace(emojiPattern, '')
        let trackValues = [];
        let playlistTrackValues = [];
        let artistValues = [];
        let trackArtistValues = [];

        if (playlist.id != null) {
          try {
            connection.execute('INSERT IGNORE INTO Playlist VALUES (?, ?, ?)', [playlist.id, playlist.href, playlist.name]);
            connection.execute('INSERT IGNORE INTO UserPlaylist VALUES (?, ?)', [req.session.user, playlist.id]);
          }
          catch (err) {
            console.log(err)
          }
          
          let trackOffset = 0;
          flag = 1;

          while (flag) {
            const playlistTracks = await handleRateLimit(() => spotifyApi.getPlaylistTracks(playlist.id, { limit: 100, offset: trackOffset }));
            if (playlistTracks.body.next == null) {
              flag = 0;
            }
            const trackIds = playlistTracks.body.items.map(item => item.track.id);
            const audioFeaturesData = await handleRateLimit(() => spotifyApi.getAudioFeaturesForTracks(trackIds));
            const audioFeatures = audioFeaturesData.body.audio_features;


            playlistTracks.body.items.forEach((item, index) => {
              trackValues.push([
                item.track.id,
                audioFeatures[index].tempo,
                audioFeatures[index].valence,
                audioFeatures[index].liveness,
                audioFeatures[index].instrumentalness,
                audioFeatures[index].acousticness,
                audioFeatures[index].speechiness,
                audioFeatures[index].mode,
                audioFeatures[index].key,
                audioFeatures[index].energy,
                audioFeatures[index].danceability,
                item.track.duration_ms,
                item.track.popularity,
                item.track.name,
                item.track.album.name
              ]);
              

              playlistTrackValues.push([item.track.id, playlist.id]);

              item.track.artists.forEach(artist => {
                let image;
                if (artist.images) {
                  image = artist.images[0].url;
                } else {
                  image = "";
                }
                artistValues.push([artist.id, artist.name, image, artist.href]);
                trackArtistValues.push([item.track.id, artist.id]);
              });
            });
            
            trackOffset += 100;
          }
          if (trackValues != null && trackValues.length > 0) {
            connection.query('INSERT IGNORE INTO Track VALUES ?', [trackValues]);
            connection.query('INSERT IGNORE INTO Playlist_Track VALUES ?', [playlistTrackValues]);
            connection.query('INSERT IGNORE INTO Artist VALUES ?', [artistValues]);
            connection.query('INSERT IGNORE INTO Track_Artist VALUES ?', [trackArtistValues]);
          }


        }
      }
      offset += 50;
    }

    flag = 1;
    trackOffset = 0;
    let trackValues = [];
    let userLikes = [];
    let artistValues = [];
    let trackArtistValues = [];
    while (flag) {
      const ls = await handleRateLimit(() => spotifyApi.getMySavedTracks({ limit: 50, offset: trackOffset }));
      if (ls.body.next == null) {
        flag = 0;
      }
      const trackIds = ls.body.items.map(item => item.track.id);
      const audioFeaturesData = await handleRateLimit(() => spotifyApi.getAudioFeaturesForTracks(trackIds));
      const audioFeatures = audioFeaturesData.body.audio_features;


      ls.body.items.forEach((item, index) => {
        console.log(index)
        trackValues.push([
          item.track.id,
          audioFeatures[index].tempo,
          audioFeatures[index].valence,
          audioFeatures[index].liveness,
          audioFeatures[index].instrumentalness,
          audioFeatures[index].acousticness,
          audioFeatures[index].speechiness,
          audioFeatures[index].mode,
          audioFeatures[index].key,
          audioFeatures[index].energy,
          audioFeatures[index].danceability,
          item.track.duration_ms,
          item.track.popularity,
          item.track.name,
          item.track.album.name
        ]);
        

        userLikes.push([item.track.id,req.session.user]);

        item.track.artists.forEach(artist => {
          let image;
          if (artist.images) {
            image = artist.images[0].url;
          } else {
            image = "";
          }
          
          artistValues.push([artist.id, artist.name, image, artist.href]);
          trackArtistValues.push([item.track.id, artist.id]);
        });
      });
      
      trackOffset += 50;
    }

    console.log(userLikes)
    connection.query('INSERT IGNORE INTO Track VALUES ?', [trackValues]);
    connection.query('INSERT IGNORE INTO UserLikes (TrackID, UserID) VALUES ?', [userLikes], function(err, results) {
      if (err) {
        // Handle error
        console.error(err);
      } else {
        // Success
        console.log(results);
      }
    });
    connection.query('INSERT IGNORE INTO Artist VALUES ?', [artistValues]);
    connection.query('INSERT IGNORE INTO Track_Artist VALUES ?', [trackArtistValues]);





    trackValues = [];
    userLikes = [];
    artistValues = [];
    trackArtistValues = [];
let i = 0;
let hashmap = {};
let ranges = ['long_term', 'medium_term', 'short_term']
while (i < 3) {
    let count = 0;
    let flag = 1;
      while (flag && count < 2) {
        const ls = await handleRateLimit(() => spotifyApi.getMyTopTracks({
          time_range: ranges[i],
          limit: 50,
          offset: count * 50
        }));

        if (ls.body.next == null) {
          flag = 0;
        }
        
        const trackIds = ls.body.items.map(item => item.id);
        const audioFeaturesData = await handleRateLimit(() => spotifyApi.getAudioFeaturesForTracks(trackIds));
        const audioFeatures = audioFeaturesData.body.audio_features;
        ls.body.items.forEach((item, index) => {
          trackValues.push([
            item.id,
            audioFeatures[index].tempo,
            audioFeatures[index].valence,
            audioFeatures[index].liveness,
            audioFeatures[index].instrumentalness,
            audioFeatures[index].acousticness,
            audioFeatures[index].speechiness,
            audioFeatures[index].mode,
            audioFeatures[index].key,
            audioFeatures[index].energy,
            audioFeatures[index].danceability,
            item.duration_ms,
            item.popularity,
            item.name,
            item.album.name
          ]);
        
          

          item.artists.forEach(artist => {
            let image;
            if (artist.images) {
              image = artist.images[0].url;
            } else {
              image = "";
            }
            artistValues.push([artist.id, artist.name, image, artist.href]);
            trackArtistValues.push([item.id, artist.id]);
          });

          
          if (!(item.id in hashmap)) {
            hashmap[item.id] = {};
          }
          hashmap[item.id][ranges[i]] = index + count * 50;
          
        });
        
        count++;
     
      }
      i++;
    }
    
   
    ratingValues = [];
    for (let key in hashmap) {
      short = 100;
      medium = 100;
      long = 100;
      if ('short_term' in hashmap[key]) {
        short = hashmap[key]['short_term'];
      }
      if ('medium_term' in hashmap[key]) {
        medium = hashmap[key]['medium_term'];
      }
      if ('long_term' in hashmap[key]) {
        long = hashmap[key]['long_term'];
      }
      ratingValues.push([key, req.session.user,short, medium, long]);
    }
    

    connection.query('INSERT IGNORE INTO Track VALUES ?', [trackValues]);
    
    connection.query('INSERT IGNORE INTO Artist VALUES ?', [artistValues]);
    connection.query('INSERT IGNORE INTO Track_Artist VALUES ?', [trackArtistValues]);
    connection.query('INSERT IGNORE INTO Top_Saved_Track VALUES ?', [ratingValues]);


    const referer = req.get('Referer');
    if (referer) {
      return res.redirect(referer);
    } else {
      // Fallback if referer is not set
      return res.redirect('/playlists');
    }

  } catch (error) {
    console.error(error);
    if (error.statusCode === 401) {
      return res.redirect('/login');
    }
    res.status(500).send('Internal Server Error');
  }
});

app.get('/playlists', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  try {
    // Query to get playlists associated with the user
    const playlistsQuery = `
      SELECT p.PlaylistID, p.PlaylistName
      FROM Playlist p
      JOIN UserPlaylist up ON p.PlaylistID = up.PlaylistID
      WHERE up.UserID = ?;
    `;
    const [userPlaylists] = await connection.promise().execute(playlistsQuery, [req.session.user]);

    let allPlaylists = [];

    for (const playlist of userPlaylists) {
      // Query to get tracks for each playlist
      const tracksQuery = `
        SELECT *
        FROM Track t
        JOIN Playlist_Track pt ON t.TrackID = pt.TrackID
        WHERE pt.PlaylistID = ?;
      `;
      const [tracks] = await connection.promise().execute(tracksQuery, [playlist.PlaylistID]);

      // Add playlist data along with tracks to the allPlaylists array
      allPlaylists.push({
        id: playlist.PlaylistID,
        name: playlist.PlaylistName,

        tracks: tracks
      });
      
    }
    
    // Send Data to Front-End
    res.render('playlists', { playlists: allPlaylists });
  } catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});







const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});




