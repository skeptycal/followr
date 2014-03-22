/// Followr Inject.js

$(function() {
	var maxQueries = 12, // default queries
		timeInbetweenTweets = 1500,
		bindScoreToRealUserAction,
		addToScore,
		favoriteTweetIter,
		getNumTweets,
		runFollowr,
		twitter = {};

	// Get MaxQueries -- not too worried about the race condition
	chrome.runtime.sendMessage({
		message: 'getMaxQueries'
	}, function(mQ) {
		maxQueries = mQ;
	});

	chrome.runtime.sendMessage({
		message: 'getLoggedInStatus'
	}, function(backendThinksLoggedIn) {
		if ($('body').hasClass('logged-in')) {
			chrome.runtime.sendMessage({
				message: 'setLoggedInStatus',
				data: true
			});

			if (!backendThinksLoggedIn) {
				chrome.runtime.sendMessage({
					message: 'forceRun'
				});
			}
		} else {
			chrome.runtime.sendMessage({
				message: 'setLoggedInStatus',
				data: false
			});
		}
	});

	addToScore = function(tweetId) {
		chrome.runtime.sendMessage({
			'message': 'setTweetWithAction',
			data: {
				id: tweetId
			}
		});
	};

	bindScoreToRealUserAction = function() {
		var bindScoreFunc = function() {
			var $this = $(this),
				tweetReply = $(this).closest('div.inline-reply-tweetbox'),
				tweetElem = tweetReply.length ? tweetReply.prev() : $this.closest('div.tweet'),
				tweetId = tweetElem.attr('data-tweet-id');

			addToScore(tweetId);
		};

		$('body').on('submit', '.tweet-form', bindScoreFunc);
		$('body').on('mouseup', '.tweet-form button.tweet-btn', bindScoreFunc);
		$('body').on('mousedown', '.retweet', bindScoreFunc);
	};
	bindScoreToRealUserAction();

	runFollowr = window.runFollowr = function() {
		chrome.runtime.sendMessage({
			'message': 'runningStatus'
		});

		// Set Up Twitter API Calls
		twitter.authenticity_token = $('input[name="authenticity_token"]').val();

		if (twitter.authenticity_token && $('body').hasClass('logged-in')) {
			// Set up the status interface
			var $followr = $('<div class="followr"></div>'),
				$followrWrap = $('<div class="followr-wrap"></div>'),
				$state = $('<span id="followr-state"></span>'),
				$buckets = $('<table class="buckets"></table>'),
				$description = $('<p class="state-descript">Favoriting some tweets!</p>');

			$followr.appendTo($('body'));
			$followrWrap.appendTo($followr);
			$description.appendTo($followrWrap);
			$state.appendTo($followrWrap);
			$state.append($buckets);

			document.title = 'Followr - Running...';
		} else {
			window.close();
		}

		twitter.getTweets = function(currentQueryIndex, queries, cb, options) {
			var url,
				query = queries[currentQueryIndex];

			options = options || {};

			url = 'https://twitter.com/i/search/timeline?q=' + encodeURIComponent(query.query) + '&src=typd&include_available_features=1&include_entities=1&last_note_ts=0';
			if (options && options.lastTweetId && options.firstTweetId) {
				url += '&scroll_cursor=TWEET-'+options.lastTweetId+'-'+options.firstTweetId;
			}

			$.ajax({
				url: url,
				dataType: 'json',
				success: function(data, d) {
					var itemHTML = data.inner ? data.inner.items_html : undefined,
						items = itemHTML ? itemHTML.match(/data-item-id="([0-9]{18})/g) : [],
						numNewItems = 0,
						totalItems = [],
						i;

					// TODO: make the regexp more accurate.
					items = $.map(items, function(item, j) {
						item = item.replace('data-item-id="', '');
						return ((j % 2) === 0) ? item : undefined;	
					});
					items.pop();

					numNewItems = items.length;
					queries[currentQueryIndex].items = queries[currentQueryIndex].items.concat(items);
					items = queries[currentQueryIndex].items;

					if (items.length <= 50 && numNewItems > 10) {
						// get more items for same query
						twitter.getTweets(currentQueryIndex, queries, cb, {
							firstTweetId: items[0],
							lastTweetId: items[items.length-1]
						});
					} else {
						if (currentQueryIndex < queries.length-1) {
							// Next query
							twitter.getTweets(currentQueryIndex+1, queries, cb);
						} else {
							cb(queries);
						}
					}
				}
			});
		};
		twitter.favoriteTweet = function(id, cb) {
			$.ajax({
				url: 'https://twitter.com/i/tweet/favorite',
				dataType: 'json',
				type: 'POST',
				data: {
					'authenticity_token': twitter.authenticity_token,
					'id': id
				},
				success: function(data) {
					if (cb) cb(data);
				}
			});
		};

		favoriteTweetIter = function(options) {
			var progressCounter = (1 + options.bucketIndex) + options.itemIndex * options.tweetBuckets.length,
				tweetInMilliseconds = timeInbetweenTweets * progressCounter,
				statusString = progressCounter + '/' + options.numTweets;

			setTimeout(function() {
				var tweetId = options.tweetBuckets[options.bucketIndex].items[options.itemIndex],
					$statusNum = options.templates[options.bucketIndex].find('td.statusNum');	

				options.templates[options.bucketIndex].find('span.status span').css({
					width: Math.floor(200 * ((options.itemIndex+1)/options.tweetBuckets[options.bucketIndex].items.length))
				});
				$statusNum.html((options.itemIndex+1)+'/'+options.tweetBuckets[options.bucketIndex].items.length);

				document.title = '(' + statusString + ') Followr - Running...';

				chrome.runtime.sendMessage({
					'message': 'setFavorited',
					data: {
						id: tweetId
					}
				});
				twitter.favoriteTweet(tweetId);

				// Last tweet send, close the window
				if (progressCounter >= options.numTweets) {
					window.close();
				}

			}, tweetInMilliseconds + (Math.random() * timeInbetweenTweets/2));
		};

		getNumTweets = function(tweetBuckets) {
			var numTweets = 0,
				a;
			for (a = 0; a < tweetBuckets.length; a++) {
				numTweets += tweetBuckets[a].items.length;
			}
			return numTweets;
		};

		// Figure out which search query to use
		chrome.runtime.sendMessage({
			message: 'getSearchQueries'
		}, function(searchQueries) {
			var i,
				itemTemplate,
				templates = [];

			// format queries
			for (i = 0; i < searchQueries.length; i++) {
				searchQueries[i] = {
					query: searchQueries[i],
					items: []
				};
			}

			// Show search queries
			itemTemplate = _.template('<tr><td class="query"><%- query %></td><td><span class="status"><span></span></span></td><td class="statusNum">0/0</td></tr>');
			_.each(searchQueries, function(searchQuery, queryIndex) {
				var itemElement = itemTemplate(searchQuery);
				templates[queryIndex] = $(itemElement);
				$buckets.append(templates[queryIndex]);
			});

			twitter.getTweets(0, searchQueries, function(unfilteredTweetBuckets) {
				// If no tweets are returned from twitter, however unlikely,
				// exit.
				if (getNumTweets(unfilteredTweetBuckets) < 1) window.close();

				// Filter through results to make sure favorites not
				// already called.
				chrome.runtime.sendMessage({
					message: 'getNewTweets',
					data: {
						tweetBuckets: unfilteredTweetBuckets
					}
				}, function(tweetBuckets) {
					var a,
						i,
						numTweets = getNumTweets(tweetBuckets),
						randTweetMarker = [],
						$statusNum;

					if (!tweetBuckets.length || numTweets < 1) window.close();

					// Slowly favorite tweets over time and with randomness.
					for (a = 0; a < tweetBuckets.length; a++) {

						templates[a].find('td.statusNum').html('0/'+tweetBuckets[a].items.length);

						for (i = 0; i < tweetBuckets[a].items.length; i++) {
							favoriteTweetIter({
								bucketIndex: a,
								itemIndex: i,
								tweetBuckets: tweetBuckets,
								numTweets: numTweets,
								templates: templates
							});	
						}
					}
				});
			});
		});
	};
});
