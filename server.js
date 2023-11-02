var express = require('express');
var bodyParser = require('body-parser');
var mysql = require('mysql2');
var path = require('path');
const bcrypt = require('bcrypt');
const SpotifyWebApi = require('spotify-web-api-node');
const session = require('express-session');
require('dotenv').config();

var connection = mysql.createConnection({
  host: '35.226.135.62',
  user: 'root',
  password: 'Ruckus2023!',
  database: 'db'
});

connection.connect;

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
  console.log(username)
  connection.execute(sql, [username], async (err, results) => {
    console.log(results)
    console.log(results[0].hashedpassword)
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

  const authorizeURL = spotifyApi.createAuthorizeURL(['user-read-private','playlist-read-private', 'user-read-email','user-library-read','playlist-read-collaborative'], null);
  res.redirect(authorizeURL);
});

app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token, refresh_token } = data.body;
    spotifyApi.setAccessToken(access_token);
    spotifyApi.setRefreshToken(refresh_token);

    
    // Fetch Spotify user's profile
    const spotifyUserData = await spotifyApi.getMe();
    
    const { id, display_name, external_urls, images } = spotifyUserData.body;

    // Save to SpotifyProfile table
    const checkQuery = 'SELECT 1 FROM SpotifyProfile WHERE UserID = ?';
    const [rows] = await connection.promise().query(checkQuery, [id]);
    if (rows.length === 0) {
      const insertSpotifyProfile = 'INSERT INTO SpotifyProfile(UserID, DisplayName, ProfileUrl, ImageUrl, APIKey, access) VALUES (?, ?, ?, ?, ?, ?)';
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

app.get('/liked-songs', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  try {
    const query = `
        SELECT sp.APIKey, sp.access
        FROM User u
        JOIN LinkedProfile lp ON u.UserID = lp.UserID
        JOIN SpotifyProfile sp ON lp.SpotifyProfileID = sp.UserID
        WHERE u.UserID = ?;
        `;
    const [rows] = await connection.promise().execute(query, [req.session.user]);
    spotifyApi.setRefreshToken(rows[0].APIKey);
    const dat = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(dat.body['access_token']);
    flag = 1;
    count  = 0;
    var data = []
    var audioFeatures = []
    while(flag){
      const saved = await spotifyApi.getMySavedTracks({
        limit: 50,
        offset: count * 50
      });
      const trackIds = saved.body.items.map(item => item.track.id);
      const audioFeaturesData = await spotifyApi.getAudioFeaturesForTracks(trackIds);
      data = data.concat(saved.body.items);
      
      audioFeatures = audioFeatures.concat(audioFeaturesData.body.audio_features); 
      count++;
      if(saved.body.next == null){
        flag = 0;
      }
    }

    const likedSongs = data.map((item, index) => {
      const track = {
        name: item.track.name,
        artist: item.track.artists.map(artist => artist.name).join(', '),
        album: item.track.album.name,
        audioFeatures: audioFeatures[index], // Add audio features to each song
      };
      const artists = [];
      const trackartists = [];
      for (const artistData of item.track.artists) {
        
        const trackartist = [
          item.track.id,
          artistData.id
          
        ];
        const artist = [
          artistData.id,
          artistData.name,
          null,
          artistData.href
        ];
        artists.push(artist);
        trackartists.push(trackartist);
      }
      

      const artistquery = `
          INSERT IGNORE INTO Artist (ArtistID, ArtistName, ImageUrl, ProfileUrl)
          VALUES (?, ?, ?, ?);
        `;
      
      const query = `
        INSERT IGNORE INTO Track (TrackID, Tempo, Valence, Liveness, Instrumentalness, Acousticness, Speechiness, Mode, MusicKey, Energy, Danceability, Duration_ms, Popularity, Track_name, Album_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;
      const trackartistsquery = `
        INSERT IGNORE INTO Track_Artist (TrackID, ArtistID)
        VALUES (?, ?);
      `;
      const values = [
        item.track.id,
        track.audioFeatures.tempo,
        track.audioFeatures.valence,
        track.audioFeatures.liveness,
        track.audioFeatures.instrumentalness,
        track.audioFeatures.acousticness,
        track.audioFeatures.speechiness,
        track.audioFeatures.mode,
        track.audioFeatures.key,
        track.audioFeatures.energy,
        track.audioFeatures.danceability,
        item.track.duration_ms,
        item.track.popularity,
        track.name,
        track.album
      ];
      return { track, artistquery,trackartists, trackartistsquery, query, values, artists };
    });
    for (const { query, values } of likedSongs) {
      connection.execute(query, values);
    }
    
    for (const { artistquery, artists } of likedSongs) {
      for (const artist of artists){
        connection.execute(artistquery, artist);
      }
    }
    for (const {trackartistsquery, trackartists} of likedSongs) {
      for (const trackartist of trackartists){
        console.log(trackartist)
        connection.execute(trackartistsquery, trackartist);
      }
    }


    res.render('liked-songs', { likedSongs: likedSongs.map(ls => ls.track) });
  } catch (error) {
    console.error(error);
    if (error.statusCode === 401) {
      // Access token has expired, redirect to login or implement token refresh
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
    const userSpotifyDetailsQuery = `
        SELECT sp.APIKey, sp.access
        FROM User u
        JOIN LinkedProfile lp ON u.UserID = lp.UserID
        JOIN SpotifyProfile sp ON lp.SpotifyProfileID = sp.UserID
        WHERE u.UserID = ?;
    `;
    const [userSpotifyDetails] = await connection.promise().execute(userSpotifyDetailsQuery, [req.session.user]);
    spotifyApi.setRefreshToken(userSpotifyDetails[0].APIKey);
    const dat = await spotifyApi.refreshAccessToken();
    spotifyApi.setAccessToken(dat.body['access_token']);

    let allPlaylists = [];
    let offset = 0;

    // Fetch all playlists
    flag2=1;
    while (flag2) {
      const playlists = await spotifyApi.getUserPlaylists({ limit: 50, offset: offset });
      if (playlists == null){
        break;
      
      };

      for (const playlist of playlists.body.items) {
        // Insert playlist into database
        const emojiPattern = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\p{Emoji}]/gu;

        console.log(playlist.name)
        playlist.name = await playlist.name.replace(emojiPattern, '')
        console.log(playlist.name)  
        if (playlist.id != null){
          try{
            connection.execute('INSERT IGNORE INTO Playlist VALUES (?, ?, ?)', [playlist.id, playlist.href, playlist.name]);}
            catch(err){
              console.log(err)
            }
        let tracks = [];
        let trackOffset = 0;
        flag =1;
        // Fetch all tracks from the playlist
        while(flag){
          const playlistTracks = await spotifyApi.getPlaylistTracks(playlist.id, { limit: 100, offset: trackOffset });
          if(playlistTracks.body.next == null){
            flag = 0;
          }
          const trackIds = playlistTracks.body.items.map(item => item.track.id);
          console.log(trackIds)
          const audioFeaturesData = await spotifyApi.getAudioFeaturesForTracks(trackIds);
          console.log(audioFeaturesData)
          const audioFeatures = audioFeaturesData.body.audio_features;
          
          
      
      
          console.log(playlistTracks)
          
          const likedSongs = playlistTracks.body.items.map((item, index) => {
  
            const track = {
              name: item.track.name,
              artist: item.track.artists.map(artist => artist.name).join(', '),
              album: item.track.album.name,
              audioFeatures: audioFeatures[index], // Add audio features to each song
            };

            
            const trackValues = [
              item.track.id,
              track.audioFeatures.tempo,
              track.audioFeatures.valence,
              track.audioFeatures.liveness,
              track.audioFeatures.instrumentalness,
              track.audioFeatures.acousticness,
              track.audioFeatures.speechiness,
              track.audioFeatures.mode,
              track.audioFeatures.key,
              track.audioFeatures.energy,
              track.audioFeatures.danceability,
              item.track.duration_ms,
              item.track.popularity,
              item.track.name,
              item.track.album.name
            ];

            const playlistTrackValues = [item.track.id, playlist.id];
            console.log(trackValues)
            const artistValues = item.track.artists.map(artist => [artist.id, artist.name, null, artist.href]);

            // Insert data into database

            connection.execute('INSERT IGNORE INTO Track VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', trackValues);
            connection.execute('INSERT IGNORE INTO Playlist_Track VALUES (?, ?)', playlistTrackValues);

            for (const artistValue of artistValues) {
              connection.execute('INSERT IGNORE INTO Artist VALUES (?, ?, ?, ?)', artistValue);
              connection.execute('INSERT IGNORE INTO Track_Artist VALUES (?, ?)', [item.track.id, artistValue[0]]);
            }

            // Prepare data for response
            tracks.push({
              id: item.track.id,
              name: item.track.name,
              artists: item.track.artists.map(artist => artist.name).join(', '),
              album: item.track.album.name
            });
          });
          trackOffset += 100;
        }

        // Prepare data for response
        allPlaylists.push({
          id: playlist.id,
          name: playlist.name,
          displayName: playlist.display_name,
          tracks: tracks
        });
      }}
      offset += 50;}
    

    // Send Data to Front-End
    res.render('playlists', { playlists: allPlaylists });
  } catch (error) {
    console.error(error);
    if (error.statusCode === 401) {
      return res.redirect('/login');
    }
    res.status(500).send('Internal Server Error');
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});