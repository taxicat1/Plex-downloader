// ==UserScript==
// @name         Plex downloader
// @description  Adds a download button to the Plex desktop interface. Works on episodes, movies, whole seasons, and entire shows.
// @author       Mow
// @version      1.3.1
// @license      MIT
// @grant        none
// @match        https://app.plex.tv/desktop/*
// @run-at       document-start
// @namespace    https://greasyfork.org/users/1260133
// ==/UserScript==


// This code is a heavy modification of the existing PlxDwnld project
// https://sharedriches.com/plex-scripts/piplongrun/

(function() {
	"use strict";
	
	const logPrefix = "[USERJS Plex Downloader]";
	const domPrefix = `USERJSINJECTED_${Math.random().toString(36).substr(2)}_`;
	
	// Settings of what element to clone, where to inject it, and any additional CSS to use
	const injectionElement = "button[data-testid=preplay-play]"; // Play button
	const injectPosition   = "after";
	const domElementStyle  = "font-weight: bold;";
	const domElementText   = "Download";
	
	
	// Server idenfitiers and their respective data loaded over API request
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
		
		// Promise for loading server data, ensure it is loaded before we try to pull data
		promise : null,
		loaded  : false,
	};
	
	// Merge new data object into serverData
	function updateServerData(newData, serverDataScope) {
		if (!serverDataScope) {
			serverDataScope = serverData;
		}
		
		for (let key in newData) {
			if (!serverDataScope.hasOwnProperty(key)) {
				serverDataScope[key] = newData[key];
			} else {
				if (typeof newData[key] === "object") {
					updateServerData(newData[key], serverDataScope[key]);
				} else {
					serverDataScope[key] = newData[key];
				}
			}
		}
	}
	
	
	// Should not be visible in normal operation
	function errorHandle(msg) {
		console.log(logPrefix + " " + msg.toString());
	}
	
	
	// Fetch XML and return parsed body
	async function fetchXml(url) {
		const xmlParser = new DOMParser();
		
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
	
	
	// Load server information for this user account from plex.tv api
	async function loadServerData() {
		// Ensure access token
		if (!localStorage.hasOwnProperty("myPlexAccessToken")) {
			errorHandle("Cannot find a valid access token (localStorage Plex token missing).");
			return;
		}
		
		const apiResourceUrl = `https://plex.tv/api/resources?includeHttps=1&X-Plex-Token=${localStorage["myPlexAccessToken"]}`;
		const resourceXml = await fetchXml(apiResourceUrl);
		
		const serverInfoXPath  = "//Device[@provides='server']";
		const servers = resourceXml.evaluate(serverInfoXPath, resourceXml, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
		// Stupid ugly iterator pattern. Yes this is how you're supposed to do this
		// https://developer.mozilla.org/en-US/docs/Web/API/XPathResult/iterateNext
		let server;
		while (server = servers.iterateNext()) {
			const clientId    = server.getAttribute("clientIdentifier");
			const accessToken = server.getAttribute("accessToken");
			if (!clientId || !accessToken) {
				errorHandle("Cannot find valid server information (missing ID or token in API response).");
				continue;
			}
			
			const connectionXPath  = "//Connection[@local='0']";
			const conn = resourceXml.evaluate(connectionXPath, server, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
			if (!conn.singleNodeValue || !conn.singleNodeValue.getAttribute("uri")) {
				errorHandle("Cannot find valid server information (no connection data for server " + clientId + ").");
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
		}
		
		serverData.loaded = true;
	}
	
	// Keep trying loading server data if it happens to fail
	async function ensureServerData() {
		await serverData.promise;
		
		if (!serverData.loaded) {
			// Reload
			serverData.promise = loadServerData();
			await serverData.promise;
		}
	}
	
	
	// Merge video node data from API response into the serverData media cache
	function updateServerDataMedia(clientId, videoNode) {
		updateServerData({
			servers : {
				[clientId] : {
					mediaData : {
						[videoNode.ratingKey] : {
							key    : videoNode.Media[0].Part[0].key,
							loaded : true,
						}
					}
				}
			}
		});
	}
	
	// Pull API response for this media item and handle parents/grandparents
	async function fetchMediaData(clientId, metadataId) {
		// Make sure server data has loaded in
		await ensureServerData();
		
		// Get access token and base URI for this server
		const baseUri     = serverData.servers[clientId].baseUri;
		const accessToken = serverData.servers[clientId].accessToken;
		
		// Request library data from this server using metadata ID
		const libraryUrl = `${baseUri}/library/metadata/${metadataId}?X-Plex-Token=${accessToken}`;
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
			
			// Manually flag parent as loaded
			serverData.servers[clientId].mediaData[metadataId].loaded = true;
		} else {
			// This is a regular media item (episode, movie)
			const videoNode = libraryJSON.MediaContainer.Metadata[0];
			updateServerDataMedia(clientId, videoNode);
		}
	}
	
	
	// Parse current URL to get clientId and metadataId, or `false` if unable to match
	function parseUrl() {
		const metadataIdRegex = new RegExp("key=%2Flibrary%2Fmetadata%2F(\\d+)");
		const clientIdRegex   = new RegExp("server\/([a-f0-9]{40})\/");
		
		let clientIdMatch = clientIdRegex.exec(location.hash);
		if (!clientIdMatch || clientIdMatch.length !== 2) return false;
		
		let metadataIdMatch = metadataIdRegex.exec(location.hash);
		if (!metadataIdMatch || metadataIdMatch.length !== 2) return false;
		
		// Get rid of extra regex matches
		let clientId   = clientIdMatch[1];
		let metadataId = metadataIdMatch[1];
		
		return {
			clientId   : clientId,
			metadataId : metadataId,
		};
	}
	
	
	// Start fetching a media item from the URL parameters, storing promise in serverData
	// Also handles avoiding duplicate API calls for the same media item
	async function initFetchMediaData() {
		let urlIds = parseUrl();
		if (!urlIds) return;
		
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
		
		if (serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].promise) {
			// Avoid double creating requests
			await serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].promise;
		}
		
		if (serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].loaded) {
			// Media item already loaded
			return;
		}
		
		let mediaPromise = fetchMediaData(urlIds.clientId, urlIds.metadataId);
		serverData.servers[urlIds.clientId].mediaData[urlIds.metadataId].promise = mediaPromise;
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
			downloadUri(makeDownloadUri(clientId, metadataId));
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
		// Steal CSS from the injection point element by copying its class name
		const downloadButton = document.createElement(injectionPoint.tagName);
		downloadButton.id = domPrefix + "DownloadButton";
		downloadButton.textContent = domElementText;
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
				errorHandle("Invalid injection position: " + injectPosition);
				break;
		}
		
		return downloadButton;
	}
	
	// Activate DOM element and hook clicking with function
	async function domCallback(domElement, clientId, metadataId) {
		
		// Make sure server data has loaded in
		await ensureServerData();
		
		// Make sure we have media data for this item
		await serverData.servers[clientId].mediaData[metadataId].promise;
		if (!serverData.servers[clientId].mediaData[metadataId].loaded) {
			errorHandle("Could not load data for metadataId " + metadataId);
			return;
		}
		
		const downloadFunction = function(e) {
			e.stopPropagation();
			cleanUpOldDownloads();
			downloadMedia(clientId, metadataId);
		}
		
		domElement.addEventListener("click", downloadFunction);
		domElement.disabled = false;
		domElement.style.opacity = 1;
	}
	
	
	// Check to see if we need to modify the DOM, do so if yes
	async function checkStateAndRun() {
		// We detect the prescence of the injection point and absence of our injected button after each page mutation
		if (document.getElementById(domPrefix + "DownloadButton")) return;
		
		const injectionPoint = document.querySelector(injectionElement);  
		if (!injectionPoint) return;
		
		const urlIds = parseUrl();
		if (!urlIds) return;
		
		const domElement = modifyDom(injectionPoint);
		try {
			await domCallback(domElement, urlIds.clientId, urlIds.metadataId);
		} catch (e) {
			errorHandle("Exception: " + e);
		}
	}
	
	
	(function init() {
		// Begin loading server data immediately
		serverData.promise = loadServerData();
		
		// Try to eager load media info
		initFetchMediaData();
		window.addEventListener("hashchange", initFetchMediaData);
		
		// Use a mutation observer to detect pages loading in
		const mo = new MutationObserver(checkStateAndRun);
		function observeDom() {
			mo.observe(document.documentElement, { childList : true, subtree : true });
		}
		
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", observeDom);
		} else {
			observeDom();
		}
		
		
	})();
	
})();
