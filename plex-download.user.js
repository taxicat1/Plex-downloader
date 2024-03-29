// ==UserScript==
// @name         Plex downloader
// @description  Adds a download button to the Plex desktop interface. Works on episodes, movies, whole seasons, and entire shows.
// @author       Mow
// @version      1.3.7
// @license      MIT
// @grant        none
// @match        https://app.plex.tv/desktop/
// @run-at       document-start
// @namespace    https://greasyfork.org/users/1260133
// ==/UserScript==


// This code is a heavy modification of the existing PlxDwnld project
// https://sharedriches.com/plex-scripts/piplongrun/

(function() {
	"use strict";
	
	const logPrefix = "[USERJS Plex Downloader]";
	const domPrefix = `USERJSINJECTED_${Math.random().toString(36).slice(2)}_`;
	
	// Settings of what element to clone, where to inject it, and any additional CSS to use
	const injectionElement = "button[data-testid=preplay-play]"; // Play button
	const injectPosition   = "after";
	const domElementStyle  = "font-weight: bold;";
	const domElementText   = "Download";
	
	
	// Server identifiers and their respective data loaded over API request
	const serverData = {
		servers : {
			// Example data
			/*
			"fd174cfae71eba992435d781704afe857609471b" : {
				"baseUri"     : "https://1-1-1-1.e38c3319c1a4a0f67c5cc173d314d74cb19e862b.plex.direct:13100",
				"accessToken" : "fH5dn-HgT7Ihb3S-p9-k",
				"mediaData"   : {}
			}
			*/
		},
		
		// Promise for loading server data, ensure it is loaded before we try to pull media data
		promise : null,
	};
	
	// Merge new data object into serverData
	function updateServerData(newData, serverDataScope) {
		serverDataScope = serverDataScope || serverData;
		
		for (let key in newData) {
			if (!serverDataScope.hasOwnProperty(key) || typeof newData[key] !== "object") {
				// Write directly if key doesn't exist or key contains POD
				serverDataScope[key] = newData[key];
			} else {
				// Merge objects if needed instead
				updateServerData(newData[key], serverDataScope[key]);
			}
		}
	}
	
	
	const mo = new MutationObserver(checkStateAndRun); // checkStateAndRun hoisted from below
	
	function observeDom() {
		mo.observe(document.body, { childList : true, subtree : true });
	}
	
	function stopObservingDom() {
		mo.disconnect();
	}
	
	
	// Should not be visible in normal operation
	function errorHandle(msg) {
		console.log(`${logPrefix} ${msg.toString()}`);
	}
	
	
	// Fetch XML and return parsed body
	const xmlParser = new DOMParser();
	async function fetchXml(url) {
		const response     = await fetch(url);
		const responseText = await response.text();
		const responseXml  = xmlParser.parseFromString(responseText, "text/xml");
		return responseXml;
	}
	
	// Fetch JSON and return parsed body
	async function fetchJSON(url) {
		const response     = await fetch(url, { headers : { accept : "application/json" } });
		const responseJSON = await response.json();
		return responseJSON;
	}
	
	
	// Load server information for this user account from plex.tv API. Returns a bool indicating success
	async function loadServerData() {
		// Ensure access token
		let serverToken = window.localStorage.getItem("myPlexAccessToken");
		if (serverToken === null) {
			errorHandle(`Cannot find a valid access token (localStorage Plex token missing).`);
			return false;
		}
		
		const apiResourceUrl = `https://plex.tv/api/resources?includeHttps=1&includeRelay=1&X-Plex-Token=${serverToken}`;
		let resourceXml;
		try {
			resourceXml = await fetchXml(apiResourceUrl);
		} catch(e) {
			errorHandle(`Cannot load valid server information (resources API call returned error ${e})`);
			return false;
		}
		
		const serverInfoXPath  = "//Device[@provides='server']";
		const servers = resourceXml.evaluate(serverInfoXPath, resourceXml, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
		// Stupid ugly iterator pattern. Yes this is how you're supposed to do this
		// https://developer.mozilla.org/en-US/docs/Web/API/XPathResult/iterateNext
		let server;
		while (server = servers.iterateNext()) {
			const clientId    = server.getAttribute("clientIdentifier");
			const accessToken = server.getAttribute("accessToken");
			if (!clientId || !accessToken) {
				errorHandle(`Cannot find valid server information (missing ID or token in API response).`);
				continue;
			}
			
			const connectionXPath = "//Connection[@local='0']";
			const conn = resourceXml.evaluate(connectionXPath, server, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
			if (!conn.singleNodeValue || !conn.singleNodeValue.getAttribute("uri")) {
				errorHandle(`Cannot find valid server information (no connection data for server ${clientId}).`);
				continue;
			}
			
			const baseUri = conn.singleNodeValue.getAttribute("uri");
			
			updateServerData({
				servers : {
					[clientId] : {
						baseUri     : baseUri,
						accessToken : accessToken,
						mediaData   : {},
					}
				}
			});
			
			
			const relayXPath = "//Connection[@relay='1']";
			const relay = resourceXml.evaluate(relayXPath, server, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
			if (!relay.singleNodeValue || !relay.singleNodeValue.getAttribute("uri")) {
				// Can ignore a possible error here as this is only a fallback option
				continue;
			}
			
			const fallbackUri = relay.singleNodeValue.getAttribute("uri");
			updateServerData({
				servers : {
					[clientId] : {
						fallbackUri : fallbackUri,
					}
				}
			});
		}
		
		return true;
	}
	
	// Keep trying loading server data if it happens to fail
	async function serverDataAvailable() {
		if (!(await serverData.promise)) {
			// Reload
			serverData.promise = loadServerData();
			
			// If this one doesn't work we just fail and try again later
			return await serverData.promise;
		}
		
		return true;
	}
	
	
	// Merge video node data from API response into the serverData media cache
	function updateServerDataMedia(clientId, videoNode) {
		updateServerData({
			servers : {
				[clientId] : {
					mediaData : {
						[videoNode.ratingKey] : {
							key : videoNode.Media[0].Part[0].key,
						}
					}
				}
			}
		});
	}
	
	// Pull API response for this media item and handle parents/grandparents. Returns a bool indicating success
	async function loadMediaData(clientId, metadataId) {
		// Make sure server data has loaded in
		if (!(await serverDataAvailable())) {
			errorHandle(`Server information loading failed, trying again on next trigger.`);
			return false;
		}
		
		// Get access token and base URI for this server
		if (!serverData.servers[clientId].hasOwnProperty("baseUri") ||
			!serverData.servers[clientId].hasOwnProperty("accessToken")) {
			errorHandle(`No server information for clientId ${clientId} when trying to load media data`);
			return false;
		}
		
		const baseUri     = serverData.servers[clientId].baseUri;
		const accessToken = serverData.servers[clientId].accessToken;
		
		try {
			// Request library data from this server using metadata ID
			const libraryUrl  = `${baseUri}/library/metadata/${metadataId}?X-Plex-Token=${accessToken}`;
			const libraryJSON = await fetchJSON(libraryUrl);
			
			// Determine if this is media or just a parent to media
			let leafCount = false;
			if (libraryJSON.MediaContainer.Metadata[0].hasOwnProperty("leafCount")) {
				leafCount = libraryJSON.MediaContainer.Metadata[0].leafCount;
			}
			
			let childCount = false;
			if (libraryJSON.MediaContainer.Metadata[0].hasOwnProperty("childCount")) {
				childCount = libraryJSON.MediaContainer.Metadata[0].childCount;
			}
			
			if (leafCount || childCount) {
				// This is a group media item (show, season) with children
				
				// Get all of its children, either by leaves or children directly
				// A series only has seasons as children, not the episodes. allLeaves must be used there
				let childrenUrl;
				if (childCount && leafCount && (childCount !== leafCount)) {
					childrenUrl = `${baseUri}/library/metadata/${metadataId}/allLeaves?X-Plex-Token=${accessToken}`;
				} else {
					childrenUrl = `${baseUri}/library/metadata/${metadataId}/children?X-Plex-Token=${accessToken}`;
				}
				
				const childrenJSON = await fetchJSON(childrenUrl);
				const childVideoNodes = childrenJSON.MediaContainer.Metadata;
				
				// Iterate over the children of this media item and gather their data
				serverData.servers[clientId].mediaData[metadataId].children = [];
				
				for (let i = 0; i < childVideoNodes.length; i++) {
					let childMetadataId = childVideoNodes[i].ratingKey;
					updateServerDataMedia(clientId, childVideoNodes[i]);
					
					serverData.servers[clientId].mediaData[metadataId].children.push(childMetadataId);
					
					// Copy promise to child
					serverData.servers[clientId].mediaData[childMetadataId].promise = serverData.servers[clientId].mediaData[metadataId].promise;
				}
			} else {
				// This is a regular media item (episode, movie)
				const videoNode = libraryJSON.MediaContainer.Metadata[0];
				updateServerDataMedia(clientId, videoNode);
			}
		} catch(e) {
			// Initial request(s) failed, but we can try again if there is a fallback to use
			if (serverData.servers[clientId].fallbackUri) {
				serverData.servers[clientId].baseUri = serverData.servers[clientId].fallbackUri;
				serverData.servers[clientId].fallbackUri = false;
				
				// Run again from the top
				return await loadMediaData(clientId, metadataId);
			} else {
				errorHandle(`Could not establish connection to server at ${serverData.servers[clientId].baseUri}: ${e}`);
				return false;
			}
		}
		
		return true;
	}
	
	// Try to ensure media data is loaded for a given item. Returns a bool indicating if the item is available
	async function mediaDataAvailable(clientId, metadataId) {
		if (serverData.servers[clientId].mediaData[metadataId].promise) {
			return await serverData.servers[clientId].mediaData[metadataId].promise;
		} else {
			return false;
		}
	}
	
	// Parse current URL to get clientId and metadataId, or `false` if unable to match
	const metadataIdRegex = /^\/library\/metadata\/(\d+)$/;
	const clientIdRegex   = /^\/server\/([a-f0-9]{40})\/details$/;
	function parseUrl() {
		if (!location.hash.startsWith("#!/")) return false;
		
		// Use a URL object to parse the shebang
		let shebang = location.hash.slice(2);
		let hashUrl = new URL("https://dummy.plex.tv" + shebang);
		
		// URL.pathname should be something like:
		//  /server/fd174cfae71eba992435d781704afe857609471b/details 
		let clientIdMatch = clientIdRegex.exec(hashUrl.pathname);
		if (!clientIdMatch || clientIdMatch.length !== 2) return false;
		
		// URL.searchParams should be something like:
		//  ?key=%2Flibrary%2Fmetadata%2F25439&context=home%3Ahub.continueWatching~0~0 
		// of which we only care about ?key=[], which should be something like:
		//  /library/metadata/25439 
		let mediaKey = hashUrl.searchParams.get("key");
		let metadataIdMatch = metadataIdRegex.exec(mediaKey);
		if (!metadataIdMatch || metadataIdMatch.length !== 2) return false;
		
		// Get rid of regex match and retain only capturing group
		let clientId   = clientIdMatch[1];
		let metadataId = metadataIdMatch[1];
		
		return {
			clientId   : clientId,
			metadataId : metadataId,
		};
	}
	
	
	// Start fetching a media item from the URL parameters, storing promise in serverData
	// Also handles avoiding duplicate API calls for the same media item
	async function handleHashChange() {
		let urlIds = parseUrl();
		if (!urlIds) {
			// If not on the right URL to inject new elements, don't bother observing
			// Note: this assumes the URL which triggers pulling media data is the same URL which
			//       is where the new element and functionality is to be injected. This is 
			//       currently true but may change in future plex desktop app updates.
			stopObservingDom();
			return;
		}
		
		// URL matches, observe the DOM for when the injection point loads
		// Also handle readyState if this is the page we start on
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", observeDom);
		} else {
			observeDom();
		}
		
		// Create media entry early
		updateServerData({
			servers : {
				[urlIds.clientId] : {
					mediaData : {
						[urlIds.metadataId] : { }
					}
				}
			}
		});
		
		if (!(await mediaDataAvailable(urlIds.clientId, urlIds.metadataId))) {
			let mediaPromise = loadMediaData(urlIds.clientId, urlIds.metadataId);
			serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].promise = mediaPromise;
		}
	}
	
	// Initiate a download of a URI using iframes
	function downloadUri(uri) {
		let frame = document.createElement("iframe");
		frame.name = domPrefix + "downloadFrame";
		frame.style = "display: none !important;";
		document.body.appendChild(frame);
		frame.src = uri;
	}
	
	// Clean up old DOM elements from previous downloads, if needed
	function cleanUpOldDownloads() {
		// There is no way to detect when the download dialog is closed, so just clean up here to prevent DOM clutter
		let oldFrames = document.getElementsByName(domPrefix + "downloadFrame");
		while (oldFrames.length !== 0) {
			oldFrames[0].remove();
		}
	}
	
	// Assemble download URI from key and base URI
	function makeDownloadUri(clientId, metadataId) {
		const key         = serverData.servers[clientId].mediaData[metadataId].key;
		const baseUri     = serverData.servers[clientId].baseUri;
		const accessToken = serverData.servers[clientId].accessToken;
		
		const uri = `${baseUri}${key}?X-Plex-Token=${accessToken}&download=1`;
		return uri;
	}
	
	// Download a media item, handling parents/grandparents
	function downloadMedia(clientId, metadataId) {
		
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("key")) {
			const uri = makeDownloadUri(clientId, metadataId);
			downloadUri(uri);
		}
		
		if (serverData.servers[clientId].mediaData[metadataId].hasOwnProperty("children")) {
			for (let i = 0; i < serverData.servers[clientId].mediaData[metadataId].children.length; i++) {
				let childId = serverData.servers[clientId].mediaData[metadataId].children[i];
				downloadMedia(clientId, childId);
			}
		}
	}
	
	
	// Create and add the new DOM elements, return an object with references to them
	function modifyDom(injectionPoint) {
		// Clone the tag of the injection point element
		const downloadButton = document.createElement(injectionPoint.tagName);
		downloadButton.id = domPrefix + "DownloadButton";
		downloadButton.textContent = domElementText;
		// Steal CSS from the injection point element by copying its class name
		downloadButton.className = domPrefix + "element" + " " + injectionPoint.className;
		downloadButton.style = domElementStyle;
		
		// Starts disabled
		downloadButton.style.opacity = 0.5;
		downloadButton.disabled = true;
		
		switch (injectPosition.toLowerCase()) {
			case "after":
				injectionPoint.after(downloadButton);
				break;
			
			case "before":
				injectionPoint.before(downloadButton);
				break;
			
			default:
				errorHandle(`Invalid injection position: ${injectPosition}`);
				break;
		}
		
		return downloadButton;
	}
	
	// Activate DOM element and hook clicking with function. Returns bool indicating success
	async function domCallback(domElement, clientId, metadataId) {
		// Make sure server data has loaded in
		if (!(await serverDataAvailable())) {
			errorHandle(`Server information loading failed, trying again on next trigger.`);
			return false;
		}
		
		// Make sure we have media data for this item
		if (!(await mediaDataAvailable(clientId, metadataId))) {
			errorHandle(`Could not load data for metadataId ${metadataId}`);
			return false;
		}
		
		// Hook function to button if everything works
		const downloadFunction = function(e) {
			e.stopPropagation();
			cleanUpOldDownloads();
			downloadMedia(clientId, metadataId);
		};
		domElement.addEventListener("click", downloadFunction);
		
		return true;
	}
	
	
	// Check to see if we need to modify the DOM, do so if yes
	async function checkStateAndRun() {
		// Detect the presence of the injection point first
		const injectionPoint = document.querySelector(injectionElement);  
		if (!injectionPoint) return;
		
		// We can always stop observing when we have found the injection point
		// Note: This relies on the fact that the page does not mutate without also
		//       triggering hashchange. This is currently true (most of the time) but
		//       may change in future plex desktop updates
		stopObservingDom();
		
		// Should be on the right URL if we're observing the DOM and the injection point is found
		const urlIds = parseUrl();
		if (!urlIds) return;
		
		// Make sure we don't ever double trigger for any reason
		if (document.getElementById(domPrefix + "DownloadButton")) return;
		
		// Inject new button and await the data to add functionality
		const domElement = modifyDom(injectionPoint);
		let success = await domCallback(domElement, urlIds.clientId, urlIds.metadataId);
		if (success) {
			domElement.disabled = false;
			domElement.style.opacity = 1;
		} else {
			domElement.style.opacity = 0.25;
		}
	}
	
	
	(function init() {
		// Begin loading server data immediately
		serverData.promise = loadServerData();
		
		// Try to start immediately
		handleHashChange();
		window.addEventListener("hashchange", handleHashChange);
	})();
	
})();
