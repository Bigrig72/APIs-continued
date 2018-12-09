'use strict';

// app dependencies
const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

// load environment variables
require('dotenv').config();

// setup app constants
const PORT = process.env.PORT;
const app = express();

// setup database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('err', err => console.log(err));

// allow public access to our API
app.use(cors());

// handle incoming requests
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovie);
app.get('/meetups', getMeetup);
app.get('/trails', getTrails);

// handle errors
function handleError(err, res) {
  console.error('ERR', err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

// location constructor - maps to our location model (schema)
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

// weather model
function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0, 15);
}


// yelp model 

function Yelp(businesses) {
  this.name = businesses.name;
  this.rating = businesses.rating;
  this.price = businesses.price;
  this.url = businesses.url;
  this.image_url = businesses.image_url;
};

// movies model

function Movie(data) {
  this.title = data.title;
  this.popularity = data.popularity;
  this.released_on = data.released_on;
  this.creation = data.creation;
  this.image_url = 'https://image.tmdb.org/t/p/w370_and_h556_bestv2/' + data.poster_path;
};

// meet up model

function Meetup(data) {
  this.link = data.link;
  this.name = data.name;
  this.creation_date = new Date(data.created * 1000).toDateString();
  this.host = data.host;
};





function Trails(data) {
  this.name = data.name;
  this.location = data.location;
  this.length = data.length;
  this.stars = data.stars;
  this.star_votes = data.starVotes;
  this.summary = data.summary;
  this.trails_url = data.url;
  this.conditions = data.conditions;
  this.created_at = Date.now();
}

// pull from cache or make request
function getLocation(request, response) {
  console.log('inside get location function');
  const locationHandler = {
    query: request.query.data,
    cacheHit: (results) => {
      console.log('Got data from SQL');
      response.send(results.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(request.query.data)
        .then(data => response.send(data))
        .catch(error => handleError(error, res));
    },
  };

  Location.lookupLocation(locationHandler);
}

// WEATHER SPECIFICS - READ THROUGH THESE AND RELATE BACK TO
// WHAT WE DID FOR LOCATION FOR CONTEXT
function getWeather(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: (result) => {
      console.log('got some weather data from SQL')
      response.send(result.rows);
    },

    cacheMiss: () => {
      Weather.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    },
  };

  Weather.lookup(handler);
}

function getYelp(request, response) {
  console.log('made it in get yelp function');
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Yelp.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    },
  };
  Yelp.lookup(handler);
}

function getMovie(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Movie.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    },
  };
  Movie.lookup(handler);
}

function getMeetup(request, response) {

  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Meetup.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);
    },
  };
  Meetup.lookup(handler);

};

function getTrails(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Trails.fetch(request.query.data)
        .then(results => response.send(results))
        .catch(console.error);

    }
  };
  Trails.lookup(handler);
};


// save to the database method
Location.prototype.save = function () {
  const SQL = `
    INSERT INTO locations
      (search_query,formatted_query,latitude,longitude) 
      VALUES($1,$2,$3,$4) 
      RETURNING id
  `;
  let values = Object.values(this);
  return client.query(SQL, values);
};

// fetch the location from the api and save it to the db
Location.fetchLocation = (query) => {
  console.log('inside fetchlocation function');
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=$
  {process.env.GEOCODE_API_KEY}`;
  return superagent.get(_URL)
    .then(data => {
      console.log('Got data from API');
      if (!data.body.results.length) { throw 'No Data'; }
      else {
        // Create an instance and save it
        let location = new Location(query, data.body.results[0]);
        return location.save()
          .then(result => {
            location.id = result.rows[0].id
            return location;
          })
      }

    }).catch(error => handleError(error, res));
};

// lookup location from db
Location.lookupLocation = (handler) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1`;
  const values = [handler.query];

  return client.query(SQL, values)
    .then(results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      }
      else {
        handler.cacheMiss();
      }
    })
    .catch(console.error);
};

// save method
Weather.prototype.save = function (id) {
  const SQL = `INSERT INTO weathers (forecast, time, location_id) VALUES ($1, $2, $3);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Weather.fetch = function (location) {
  const url = `https://api.darksky.net/forecast/${process.env.WEATHER_API_KEY}/${location.latitude},${location.longitude}`;

  return superagent.get(url)
    .then(result => {
      const weatherSummaries = result.body.daily.data.map(day => {
        const summary = new Weather(day);
        summary.save(location.id);
        return summary;
      });
      return weatherSummaries;
    });
};

Weather.lookup = function (handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};


Yelp.prototype.save = function (id) {
  const SQL = `INSERT INTO yelps (name,rating,price,url,image_url) VALUES ($1,$2,$3,$4,$5);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Yelp.fetch = function (location) {
  const url = `https://api.yelp.com/v3/businesses/search?location=/${process.env.YELP_API_KEY}/${location.latitude},${location.longitude}`;


  return superagent.get(url)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(result => {
      const yelpSum = result.body.businesses.map(businesses => {
        const summary = new Yelp(businesses);
        summary.save(location.id);
        return summary;
      });
      return yelpSum;
    });
};
Yelp.lookup = function (handler) {
  const SQL = `SELECT * FROM yelps WHERE name=$1`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('got some data from SQL yelp');
        handler.cacheHit(result);
      } else {
        console.log('you got data from the api yelp');
        handler.cacheMiss();
      }
    });
};


Movie.prototype.save = function (id) {
  const SQL = `INSERT INTO moviedbs (title,popularity,released_on,image_url) VALUES ($1,$2,$3,$4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Movie.lookup = function (handler) {
  const SQL = `SELECT * FROM moviesdbs WHERE title=$1`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('got data from sql movies');
        handler.cacheHit(result);
      } else {
        console.log('got data from the api movies');
        handler.cacheMiss();
      }
    });
};

Movie.fetch = function (location) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIEDB_API_KEY}&query=${location.search_query}`;

  return superagent.get(url)
    .then(result => {
      const movieSum = result.body.results.map(data => {
        const summary = new Movie(data);
        summary.save(location.id);
        return summary;
      });
      return movieSum;
    })
}


Meetup.prototype.save = function (id) {
  const SQL = `INSERT INTO meetups (link,name,creation_date,host)
VALUES ($1,$2,$3,$4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Meetup.lookup = function (handler) {
  const SQL = `SELECT * FROM meetups WHERE link=$1`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('got data from sql meetups');
        handler.cacheHit(result);
      } else {
        console.log('got data from the api meetups')
        handler.cacheMiss();
      }
    });
};

Meetup.fetch = function (location) {
  const url = `https://api.meetup.com/2/open_events?&key=${process.env.MEETUP_API_KEY}&sign=true&photo-host=public&lat=${location.latitude}&topic=softwaredev&lon=${location.longitude}&page=20`;

  return superagent.get(url)
    .then(result => {
      const meetupSum = result.body.results.map(data => {
        const summary = new Meetup(data);
        summary.save(location.id);
        return summary;
      });
      return meetupSum;
    })
}

Trails.prototype.save = function (id) {
  const SQL = `INSERT INTO trails (name,location,stars,star_votes,summary,trails_url,created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10);`;
  let values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Trails.lookup = function (handler) {
  const SQL = `SELECT * FROM trails WHERE name=$1`;
  client.query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('got data from sql trails')
        handler.cacheHit(result);
      } else {
        console.log('got data from the api trails')
        handler.cacheMiss();
      }
    });
};

Trails.fetch = function (location) {
  const url = `https://www.hikingproject.com/data/get-trails?lat=${location.latitude}&lon=${location.longitude}&maxDistance=20&key=${process.env.TRAIL_API_KEY}`;

  return superagent.get(url)
    .then(result => {
      const trailsSum = result.body.trails.map(data => {
        const summary = new Trails(data);
        summary.save(location.id);
        return summary;
      });
      return trailsSum;
    });
};


app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});