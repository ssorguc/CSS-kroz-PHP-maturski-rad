(function($) {
  var $grvWindow = $(window),
      $grvArticleTitles,
      $grvImgLinks,
      postMessageSupported = !!parent.postMessage,
      grvUsingDotdotdot = Boolean($.fn.dotdotdot),
      isSidebar = window.grvIsSidebar || false,
      $grvWidget,
      $grvScrollableHandle,
      grvDotdotdotInitted = false,
      $doc = $(document);

  function postParentMessage(message) {
    if (postMessageSupported && window.grvFrameUrl && parent !== window) {
      parent.postMessage(window.grvSiteGuid + '|' + window.grvPlacement + '|' + window.grvUserGuid + '|' + message, window.grvFrameUrl);
    }
  }

  var grvWatchingForHeightUpdated = false;
  function grvUpdateHeight() {
    // Set up watch for "heightUpdated" response message only once, and only if we have what we need
    if(!grvWatchingForHeightUpdated && postMessageSupported && window.grvFrameUrl && parent !== window && window.grvWidgetLoaderVersion >= 2) {
      grvWatchingForHeightUpdated = true;

      $grvWindow.bind('message', function(event) {
        var data = event.originalEvent.data,
            origin = event.originalEvent.origin;

        // Height updated
        if(data == 'heightUpdated' && window.grvFrameUrl.indexOf(origin) == 0) {
          grvWidgetDimUpdated();
        }
      });
    }

    postParentMessage('setHeight:' + (window.grvUseDynamicHeight ? $grvWidget.outerHeight(true) : window.grvStaticHeight));
  }

  function initAttribution() {
    var attribHidden = true,
        $attribToggle = $('#grv_personalization'),
        $attrib = $('#grv_tooltip').css('opacity', 0).hide(),
        serverCodeVersionOk = window.grvWidgetLoaderVersion >= 3;

    $attribToggle.click(function(e) {
      e.preventDefault();

      // Iframe widget
      if(parent !== window) {
        if(postMessageSupported && serverCodeVersionOk) {
          postParentMessage('showAttrib');
        }
        // No postMessage support
        else {
          fallbackAttributionTooltip();
        }
      }
      // JSONP widget
      else {
        // If show modal function available; might not be during deployment of this feature, but also if the client
        // cached widget loader unreasonably which is possible with widgets in the wild since eager widget loader cache
        // busting wasn't added until sidebar widget
        if(window.grvShowAttributionModal && serverCodeVersionOk)
          window.grvShowAttributionModal($);
        else
          fallbackAttributionTooltip();
      }
    });

    function fallbackAttributionTooltip() {
      if(attribHidden) {
        attribHidden = false;
        $attrib.stop().show().animate({ opacity: 1 }, 'fast');
      }
      // Shown
      else {
        attribHidden = true;
        $attrib.stop().animate({ opacity: 0 }, 50, function() {
          // Hide if still OK to hide (i.e. didn't quickly re-click)
          attribHidden && $attrib.hide();
        });
      }
    }
  }

  var grvNoFinalSlashUrl = /^[^#?]*/.exec(window.location.href)[0];

  function grvQueryString() {
    return (/\?([^#]*)/.exec(window.location.href)||[])[0] || '';
  }

  var grvScaleImages;
  (function() {
    var sidebarCssLoaded = false,
        sidebarWaitingForCssLoaded = false;
    
    grvScaleImages = function() {
      // Hide images if the document doesn't have width
      if($doc.width() <= 1)
        $grvImgLinks.css('opacity', 0);

      // Is sidebar widget
      if(isSidebar) {
        // CSS loaded; OK to scale images
        if(sidebarCssLoaded)
          doScaleImages();
        // Need to wait for CSS (only if not already waiting)
        else if(!sidebarWaitingForCssLoaded) {
          sidebarWaitingForCssLoaded = true;
          doScaleImagesAfterSidebarCssLoaded();
        }
      }
      // Not sidebar; OK to scale images immediately as CSS is guaranteed to be loaded
      else
        doScaleImages();

      // Show images when the document has width
      if($doc.width() > 1 || (navigator && navigator.userAgent && navigator.userAgent.indexOf('MSIE') != -1))
        $grvImgLinks.css('opacity', 1);
    };

    function doScaleImages() {
      $grvImgLinks.each(scaleThisImgLink);
    }

    function doScaleImagesAfterSidebarCssLoaded() {
      var $testStylesElem = $('<div id="grvSidebarStylesLoaded" />').appendTo('body'),
          stylesReadyInterval = setInterval(function() {
            if(parseInt($testStylesElem.width()) === 1 && parseInt($testStylesElem.height()) === 1) {
              clearInterval(stylesReadyInterval);
              $testStylesElem.remove();
              doScaleImages();
            }
          }, 50);
    }

    var scaleThisImgLink = function() {
      var $link = $(this),
          articleTitle = $link.attr('title'),
          width = parseInt($link.width()),
          height = parseInt($link.height()),
          lastWidth = $link.data('lastWidth') || null,
          lastHeight = $link.data('lastHeight') || null,
          imageUrl = $link.data('imageUrl') || '',
          thumbUrl = 'http://a.rtb.grvcdn.com/t/' + width + 'x' + height + '/North/?url=' + encodeURIComponent(imageUrl);

      // Using Thumby
      if(window.grvUseThumby) {
        // New <img /> required if no <img /> yet or image link dim changed
        var $existentImg = $link.find('.grv_article_img'),
            newImgRequired = !$existentImg.length
                             || width !== lastWidth
                             || height !== lastHeight;

        // <img /> needed and dependent data available
        if(newImgRequired && width && height && imageUrl) {
          $existentImg.length && $existentImg.remove();

          // Store last width/height
          $link.data('lastWidth', width).data('lastHeight', height);

          // The new image thumb
          $('<img class="grv_article_img" />')
              .attr('title', articleTitle)
              .one('error', function() {
                onImageError.call(this, width, height);
              })
              .one('load', function() {
                // Bad image; could be Thumby or partner error; note that image "load" event is not cross-browser friendly
                // so this fail safe won't even work all the time. Note also that dummy new Image() is used to determine
                // size because this <img />'s size is subject to partner-specific CSS, etc.
                var image = new Image();
                image.src = this.src;
                if(parseInt(image.width) === 1 || parseInt(image.height) === 1) {
                  onImageError.call(this, width, height);
                }
                image = null;
              })
              .attr('src', thumbUrl)
              .appendTo($link);
        }
      }
      // Not using Thumby
      else {
        // This routine currently jumps through a few hoops to support partial deployment where assets are deployed to a
        // server but server code is not. It also uses most of the legacy code which causes a duplicate <img /> tag to be
        // rendered in order to bind "load"; after full deployment, this can be simplified.

        // Create image if needed
        var $img = $link.find('.grv_article_img');
        if (!$img.length) $img = $('<img class="grv_article_img" />').attr('src', imageUrl).appendTo($link).attr('title', articleTitle);
        $img.addClass('grv_positionable'); // Ensure class; when server code is not deployed, the tag will be there but not this class

        // Image dim already known
        if($img.data('imageWidth') && $img.data('imageHeight')) {
          alignImage($link, $img, $img.data('imageWidth'), $img.data('imageHeight'));
          alignOverlay($link, $img);
        }
        // Image dim not known; will need to load one in memory in order to capture "load" and know dim
        else {
          // Load image in memory
          $("<img/>")
            .load(function() {
              $img.data('imageWidth', this.width).data('imageHeight', this.height);
              alignImage($link, $img, $img.data('imageWidth'), $img.data('imageHeight'));
              alignOverlay($link, $img);
            })
            .one('error', function() {
              onImageError.call($img[0], width, height);
            })
            .attr("src", $img.attr("src"));
        }
      }
    };

    var onImageError = function(width, height) {
      // Width and height available
      if(width && height) {
        var $img = $(this),
            brokenImgThumb = 'http://a.rtb.grvcdn.com/t/' + width + 'x' + height + '/Center/?url=' + encodeURIComponent(window.grvBrokenImgUrl);

        // Attempt to load thumbnail of error image
        $img.one('error', onImageErrorFallback).addClass('grv_full_width grv_full_height').removeClass('grv_positionable').attr('src', brokenImgThumb);
      }
      // Dimensions not available
      else {
        // Skip to the non-Thumby version of fallback image; browser will resize. Arguably with no dimensions we could
        // skip even loading the fallback image but who knows what JS/CSS might be introduced to show the image late in
        // the widget lifecycle
        onImageErrorFallback.call(this);
      }
    };

    /**
     * This would be reached if the image failed to load and the dynamic thumb version of our fallback image also failed
     * to load. This would be very rare and if it happened, we would have much more serious problems to address.
     */
    var onImageErrorFallback = function() {
      var $img = $(this);

      // Set static broken image -- browser will resize
      $img.addClass('grv_full_width grv_full_height').removeClass('grv_positionable').attr('src', window.grvBrokenImgUrl);
    };

    /**
     * Used to align image using position relative when not using Thumby (in that case, the image thumb is larger than
     * the parent link.
     *
     * @param {Object} $link       JQuery link containing the image.
     * @param {Object} $img        JQuery image.
     * @param {Number} imageWidth  Real image width.
     * @param {Number} imageHeight Real image height.
     */
    var alignImage = function($link, $img, imageWidth, imageHeight) {
      var linkWidth = parseInt($link.width()),
          linkHeight = parseInt($link.height()),
          linkAspectRatio = linkWidth / linkHeight,
          imgAspectRatio = imageWidth / imageHeight;

      // Image is more landscapey than parent link
      if (linkAspectRatio < imgAspectRatio) {
        $img.addClass('grv_full_height').css('left', - (((imageWidth / imageHeight) * linkHeight) - linkWidth) / 2);
        $img.removeClass('grv_full_width');
      }
      // Image is more portraity
      else {
        $img.addClass('grv_full_width').css('left', 0);
        $img.removeClass('grv_full_height');
      }
    };

    /**
     * Aligns the image overlay to the image in the case image height is less than container height. Only applicable
     * when not using Thumby (when using Thumby, the image will always be the correct size).
     *
     * @param {Object} $link JQuery link that contains the image.
     * @param {Object} $img  JQuery image.
     */
    var alignOverlay = function($link, $img) {
      if ($img.height() < $link.height()) {
        $img.siblings('.grv_post_type').css('bottom', ($link.height() - $img.height()) + 'px');
      }
    };
  })();

  function grvVerticalSpace() {
    var vert_margin;
    var totalElementsHeight;
    var totalSpaces = 2; // Accounts for the top and bottom

    if (!window.grvDoVerticalSpace) {
      return;
    }

    totalElementsHeight = $grvWidget.find('h3.grv_stories_header').outerHeight();

    totalSpaces += $('.grv_article').length;
    $('.grv_article').each(function(index) {
        totalElementsHeight += $(this).outerHeight();
    });

    if ($('#grv_badge').is(":visible")) {
      totalElementsHeight += $('#grv_badge').outerHeight();
      totalSpaces++;
    }

    vert_margin = ($grvWidget.innerHeight()-totalElementsHeight)/totalSpaces;

    $('.grv_article').css("margin-top",vert_margin);
    $grvWidget.find('h3.grv_stories_header').css("margin-top",vert_margin);
    $('#grv_badge').css("margin-top",vert_margin);
  }

  // Specifically for the basic horizontal image slider widget - i.e. - TechCrunch & Dying Scene
  function grvHorizontalSpace() {
    var widget_width, article_width;

    if (!window.grvDoHorizontalSpace) {
      return;
    }

    widget_width = $grvWidget.innerWidth()-($('.grv_article').length-1)*5;
    article_width = widget_width/$('.grv_article').length;

    $('.grv_img_link').css('width', article_width-2);
    $('.grv_post_type').css('width', article_width-2);
    $('.grv_article').each(function(index) {
        $(this).css('width', article_width);
        if ( index < $('.grv_article').length-1) {
          $(this).css('margin-right', '5px');
        }
    });
    $('.grv_article').css('width', article_width);
    grvScaleImages();
  }

  function grvBindArticleHandlers($grvparent) {
    var articles, $forwardingLink;

    $forwardingLink = $grvparent.find('[data-forward-href]');

    // ProBoards proof of concept to see if this fixes IE-related issues where forwarding link is not working; if proof
    // works fine empirically, we will remove this site-specific check and do this for all sites
    if (window.grvSiteGuid == 'a1f9015c15922698596d7c5bdd1561c2') {
      $forwardingLink.mousedown(rewriteHref);
    }
    // Non-ProBoards
    else {
      if(window.grvDoAolOmniture) {
        $forwardingLink.click(omniTrackLinkClick).bind('contextmenu', omniTrackLinkClick);
      }
      else
        $forwardingLink.click(rewriteHref).bind('contextmenu', rewriteHref);
    }

    if (window.grvShowMouseoverSlide) {
      articles = $grvparent.is('.grv_article') ? $grvparent : $grvparent.find('.grv_article');
      articles
        .mouseover(function() { $(this).children('.grv_img_link').stop().animate({"top": "80px"}, "fast"); })
        .mouseout(function() { $(this).children('.grv_img_link').stop().animate({"top": "34px"}, "fast"); })
        ;
    }

    grvToggleRatingBtnEvents($grvparent.find('.grv_thumb_rating'), true);

    grvScaleImages();
    grvVerticalSpace();

    $grvparent.find('.grv_subscriber_only')
      .bind('mouseenter', function() { $(this).siblings('.grv_subscriber_info').show(); })
      .bind('mouseleave', function() { $(this).siblings('.grv_subscriber_info').hide(); })
      ;
  }

  /**
   * @this HTMLElement A link with data-forward-href.
   */
  function omniTrackLinkClick(e) {
    e.preventDefault();
    var $link = $(this),
        linkText = $.trim($link.text()) || '(image link)',
        redirectUrl = $link.attr('data-forward-href'),
        destUrl = $link.attr('href');

    if(destUrl.indexOf('a_dgi=gravity') == -1)
      destUrl += (destUrl.indexOf('?') == -1 ? '?' : '&') + 'a_dgi=gravity';
    omniCustLink(destUrl, linkText);

    // This is totally silly but Omniture doesn't allow a way to synchronize the click tracking pixel drop
    setTimeout(function() {
      window.top.location.href = redirectUrl;
    }, 500);
  }

  /**
   * @this HTMLElement A link with data-forward-href.
   */
  function rewriteHref() {
    var $link = $(this),
        targetHref = $link.attr('data-forward-href');
    if(targetHref)
      $link.attr('href', targetHref);
  }

  function grvToggleRatingBtnEvents($btns, eventsOn) {
    var bindFunc = eventsOn ? 'bind' : 'unbind';
    $btns[bindFunc]('click', grvRateClick);
  }

  function grvRatingStr(liked, unliked, disliked) {
    if(liked) return 'like';
    else if(unliked) return 'unlike';
    else if(disliked) return 'dislike';
    else return null;
  }

  function grvRateClick(e) {
    e.preventDefault();
    var $btn = $(this),
        $btns = $btn.siblings('.grv_thumb_rating'),
        $article = $btn.closest('.grv_article'),
        clickedLike = $btn.hasClass('grv_thumbs_up'),
        unliked = clickedLike && $article.hasClass('grv_liked'),
        liked = clickedLike && !unliked,
        disliked = !liked && !unliked,
        ratingUrl = (window.grvRateRecoBaseUrl || '') + '/' + grvRatingStr(liked, unliked, disliked);

    // Disable buttons
    grvToggleRatingBtnEvents($btns, false);

    // Liked
    if(liked) {
      $article.addClass('grv_liked');
    }
    // Unliked or disliked
    else {
      $article.removeClass('grv_liked');

      // Specifically disliked
      if(disliked) {
        // Destroy article
        $article.children().animate({opacity: 0}, 500, function() {
          $article.height($article.height()).css('min-height', 0).slideUp('slow', function() {
            // Redraw scrollbar
            grvInitInnerScroll();
          });
        });
      }
    }

    var rateComplete = function() {
      // Enable buttons
      grvToggleRatingBtnEvents($btns, true);
    };

    // Has user GUID; if doesn't have user GUID, we just faked success but won't hit server
    if($.trim(window.grvUserGuid) !== '') {
      $.ajax({
        dataType: 'jsonp',
        url: ratingUrl,
        data: {
          ai: $article.attr('data-id'), // .data() would cause article ID 64-bit Long to be cast to 32-bit JS Number;
                                        // we need it kept as string to preserve precision
          sg: window.grvSiteGuid,
          ug: window.grvUserGuid
        },
        complete: rateComplete
      });
    }
  }

  function grvLoadTab() {
    var queryStr = grvQueryString();
    var tab = $(this);
    var tabId = tab.attr('data-panel-id');
    var deferredArticlesUrl = grvNoFinalSlashUrl + '/tab/' + tabId + queryStr;
    var targetPanel = $('#grv_mostPopularTab_panel_' + tabId);
    targetPanel.find('.grv_spinner').show().siblings('.grv_panel_content').hide();
    $.ajax({
      url: deferredArticlesUrl,
      timeout: 1000 * 10,
      success: function(html) {
        targetPanel.find('.grv_spinner').hide().siblings('.grv_panel_content').html(html).show();
        grvBindArticleHandlers(targetPanel);
      },
      error: function(xhr, textStatus, errorThrown) {
        targetPanel.find('.grv_spinner').hide().siblings('.grv_panel_content').html("<p>Sorry, there are no posts available right now.</p><p>Please try again later.</p>").show();
        tab.one('click', function() { grvLoadTab.call(tab); });
        $.post(grvNoFinalSlashUrl + '/log', { desc: textStatus + ': ' + errorThrown });
      }
    });
  }

  var isTouch = (('ontouchstart' in window) || (navigator.msMaxTouchPoints > 0));

  function checkRespWidth() {
    var widget_width = $grvWidget.outerWidth();

    $grvWidget.toggleClass('grv_less_820', widget_width < 820);
    $grvWidget.toggleClass('grv_less_520', widget_width < 520);
    $grvWidget.toggleClass('grv_less_322', widget_width < 322);
  }

  function grvDotdotdotCallback(isTruncated, $originalTitle) {
    $(this).attr('title', isTruncated ? $.trim($originalTitle.text()) : null);
  }

  function grvInitDotdotdot() {
    $grvArticleTitles.dotdotdot({
      callback: grvDotdotdotCallback
    });
  }

  function grvUpdateDotdotdot() {
    $grvArticleTitles.trigger('destroy.dot');
    grvInitDotdotdot();
  }

  function grvInitInnerScroll() {
    if(window.grvUseInnerScroll && $grvScrollableHandle) {
      // Wait for nanoScroller load as needed
      if(!$.fn.nanoScroller) {
        window.grvNanoScrollerLoadedCallbacks = window.grvNanoScrollerLoadedCallbacks || [];
        window.grvNanoScrollerLoadedCallbacks.push(grvInitInnerScroll);
      }
      // NanoScroller ready
      else {
        // OK, now wait for widget to be visible; JSONP widgets only
        if(!window.grvIsIframeWidget && !$grvWidget.is(':visible')) {
          var widgetVisibleInterval = setInterval(function() {
          if($grvWidget.is(':visible')) {
            clearInterval(widgetVisibleInterval);
            grvInitInnerScroll();
          }
        }, 50);
        }
        // Widget visible, good to go for nanoScroller
        else {
          // Arbitrary timeout to further let browser actually render something; fuck
          setTimeout(function() {
            $grvScrollableHandle.nanoScroller({
              contentClass: 'grv_panel_content'
            });
          }, 200);
        }
      }
    }
  }

  /**
   * For iframe widgets only, waits for a message from widget loader indicating that the iframe is now visible.
   *
   * It is very important this method is called before the "grv_show" message is posted to widget loader in order to
   * ensure our own handler for "widgetShown" is bound.
   */
  function grvBeginIframeWidgetShownWatch() {
    // Have everything we need and serving widget loader is at sufficient version
    if(postMessageSupported && window.grvFrameUrl && parent !== window && window.grvWidgetLoaderVersion >= 2) {
      var onMessage;
      $grvWindow.bind('message', onMessage = function(event) {
        var data = event.originalEvent.data,
            origin = event.originalEvent.origin;

        // Widget shown
        if(data == 'widgetShown' && window.grvFrameUrl.indexOf(origin) == 0) {
          $grvWindow.unbind('message', onMessage);
          grvWidgetDimUpdated();
          grvUpdateHeight();
          grvInitInnerScroll();
        }
      });
    }
    // Missing something; assume widget shown. For the problem this routine is solving, it won't matter anyway that we're
    // making the assumption that widget is shown. This routine has to do with dotdotdot happening too early before widget
    // is visible in iOS browsers -- those browsers do support postMessage and therefore support the above fix.
    else {
      grvWidgetDimUpdated();
      grvInitInnerScroll();
    }
  }

  function grvInitIframeWidgetInViewWatch() {
    var ordinalToArticleUrl = null;

    // Pass all displayed ordinals + articles for AOL widgets
    if(window.grvIsAolPartner) {
      ordinalToArticleUrl = {};
      $grvArticleTitles.each(function() {
        var $articleTitle = $(this);
        ordinalToArticleUrl[$articleTitle.closest('.grv_article').index().toString()] = $articleTitle.attr('href');
      });
    }

    var ivData = new window.GrvImpressionViewedData(window.grvSiteGuid, window.grvPlacement, window.grvUserGuid,
        window.grvImpressionHash, ordinalToArticleUrl);

    // No post message support
    if(!postMessageSupported) {
      window.grvSendImpressionViewed($, ivData, GrvImpressionViewedEventError.NO_POSTMESSAGE_SUPPORT);
    // Widget loader not top window
    } else if(window.parent !== window.parent.parent) {
      window.grvSendImpressionViewed($, ivData, GrvImpressionViewedEventError.WIDGET_LOADER_NOT_IN_TOP_WINDOW);
    } else {
      var $testP = $('<p />').width(1).height(1).appendTo('body'),
          boundingClientRectSupported = !!$testP[0].getBoundingClientRect();
      $testP.remove();

      // BlackBerry 5 and iOS 3 do not provide getBoundingClientRect(); it is impossible to tell if the widget enters
      // viewport on those devices
      if(!boundingClientRectSupported) {
        window.grvSendImpressionViewed($, ivData, GrvImpressionViewedEventError.NO_BOUNDING_CLIENT_RECT_SUPPORT);
      // All OK for impression viewed
      } else {
        var onMessage;
        $grvWindow.bind('message', onMessage = function(event) {
          var data = event.originalEvent.data,
              origin = event.originalEvent.origin;

          // Widget in view
          if(data == 'widgetInView' && window.grvFrameUrl.indexOf(origin) == 0) {
            $grvWindow.unbind('message', onMessage);
            window.grvSendImpressionViewed($, ivData);
          }
        });
      }
    }
  }

  /**
   * To be called when widget is positively or most likely visible (parent container and iframe are visible).
   */
  function grvWidgetDimUpdated() {
    if(grvUsingDotdotdot) {
      if(!grvDotdotdotInitted) {
        grvDotdotdotInitted = true;
        grvInitDotdotdot();
      }
      else {
        grvUpdateDotdotdot();
      }
    }
  }

  $(document).ready(function() {
    $grvWidget = $('#grv_widget');
    if(!postMessageSupported) {
      $grvWidget.addClass('grv_widget_no_postmessage');
    }

    if(window.grvUseInnerScroll) {
      $grvScrollableHandle = $grvWidget.find('.grv_panel');
    }

    $grvImgLinks = $('.grv_img_link');

    checkRespWidth();

    grvBindArticleHandlers($('body'));

    $('.grv_tab').click(function() {
      var tab = $(this);
      tab.addClass('grv_selectedTab').siblings().removeClass('grv_selectedTab');
      $('#grv_mostPopularTab_panel_' + tab.attr('data-panel-id')).show().siblings('.grv_panel').hide();
      return false;
    });

    $('.grv_deferred').one('click', grvLoadTab);

    if (window.grvBeaconUrl) {
      $.getScript(window.grvBeaconUrl);
    }

    $grvArticleTitles = $('.grv_article_title');

    grvUpdateHeight();

    (function() {
      var resizeEndTimeout;

      $grvWindow.resize(function() {
        if(resizeEndTimeout) clearTimeout(resizeEndTimeout);
        resizeEndTimeout = setTimeout(function() {
          resizeEnd();
        }, 500);
      });

      function resizeEnd() {
        //do something, window hasn't changed size in 500ms
        checkRespWidth();
        grvScaleImages();
        grvUpdateHeight();
      }
    })();

    // Iframe widget only (JSONP events handled in separate context at a later time)
    if (window.grvIsIframeWidget) {
      window.grvLogDomReadyEvent($);
      grvInitIframeWidgetInViewWatch();

      // This is a safeguard for iframe widgets. In case the widget fails to load (and hence widget.js fails to load), the
      // widget will remain hidden so the user doesn't see some error page in the iframe. In the instance widget.js loads
      // and gets to the call to this function here, we notify the widget loader via postMessage to show the widget and wait
      // for impression viewed.
      //
      // NOTE: It is important for this to come after the call to grvInitIframeWidgetInViewWatch(), which sets up "message"
      // event binding; once widget loader is instructed to show widget, it will expect widget.js to be able to receive the
      // "widgetInView" message.
      grvBeginIframeWidgetShownWatch();
      postParentMessage('grv_show');

      window.grvDoAolOmniture && aolOmniturePageview();
    }
    // Non-iframe widget
    else {
      grvWidgetDimUpdated();

      // Inner scroll will get initted for iframe widgets after iframe "shown" message received
      grvInitInnerScroll();
    }

    initAttribution();
  });

  $grvWindow.load(function() {
    // Solves issues with IE not being ready with height until window load; but we still want to fire it in DOM ready
    // block above because then our widget potentially displays sooner. Also, there is another "fail safe" especially to
    // fix IE9 where height is updated when iframe widget is positively shown (after having been notified of that by
    // widget loader via postMessage).
    grvUpdateHeight();
  });

  var omniLinkInternalFilters = '.aol.com,.mapquest.com,#dl,atwola.com,doubleclick.net,ru4.com,adsonar.com,.aol.it,about:,aol://,.aol.co.uk,.aol.ca,.aim.com,.huffingtonpost.co.uk,.huffingtonpost.ca,huff.to,.games.com,.dailyfinance.com,.stylelist.com,.patch.com,aoltv.com,aol.sportingnews.com,.engadget.com,.autoblog.com,.noisecreep.com,.theboot.com,.spinner.com,.mydaily.com,.mydaily.co.uk,.cambio.com,.moviefone.com,.mandatory.com,.pawnation.com,.theboombox.com,webmail.cs.com,.techcrunch.com,.gadling.com,aolradio.slacker.com,adtech.de,.makers.com,247wallst.com,aolcdn.com,aol.careerbuilder.com,.aolradio.com,.aolartists.com,.parentdish.co.uk,.walletpop.ca,.aolradioblog.com,aolheroes.com,shortcuts.com,joystiq.com,tuaw.com,homesessive.com,kitchendaily.com,.purpleclover.com,.huffingtonpost.com';
  function aolOmniturePageview() {
    window.bN_cfg = {
      // The "h" parameter whitelists this hostname for beacon initialization.
      // Note: Can be a string or an array of hostnames. Use "location.hostname" to match URL of current page
      h: location.hostname,

      // Serve from b.aol.com instead of b.gravity.com
      b: 'b.aol.com',

      p: {
        module: window.grvAolOmniModuleName || '',
        brand: window.grvAolOmniBrand || ''
      }
    };

    window.runOmni = function() {
      window.s_265.pfxID="gra";
      window.s_265.pageName=window.grvAolOmniModuleName || '';
      window.s_265.channel="us.gravity";
      window.s_265.linkInternalFilters="javascript:," + omniLinkInternalFilters;
      window.s_265.prop1="gravity impression";
      window.s_265.prop2=window.grvAolOmniBrand || '';
      if(window.grvAolProp21InOmniPv)
        window.s_265.prop21=1;
      window.s_265.prop22=document.URL || '';
      window.s_265.trackExternalLinks=false;
      window.s_265.referrer=window.grvReferrer || 'no referrer';
      if(window.grvAolOmniPassThru) {
        for(var key in window.grvAolOmniPassThru) {
          if(window.grvAolOmniPassThru.hasOwnProperty(key)) {
            window.s_265[key] = window.grvAolOmniPassThru[key];
          }
        }
      }
      var s_code=window.s_265.t();
    }
    window.s_265_account=window.grvAolOmniAccount;
    (function(){
      var d = document, s = d.createElement('script');
      s.type = 'text/javascript';
      s.src = (location.protocol == 'https:' ? 'https://s' : 'http://o') + '.aolcdn.com/os_merge/?file=/aol/beacon.min.js&file=/aol/omniture.min.js';
      d.getElementsByTagName('head')[0].appendChild(s);
    })();
  }

  function omniCustLink(destUrl, anchorText) {
    var co = {};

    //Custom Link tracking only for local report suite
    co.un = 'aolgravity';
    co.linkTrackVars = 'prop16,prop17,prop18,prop19,eVar1';
    co.prop16 = window.grvAolOmniModuleName || '';
    co.prop17 = destUrl;
    co.eVar1 = destUrl;
    co.prop18 = window.grvAolOmniBrand || '';
    co.prop19 = anchorText;

    //send the custom link request
    window.s_265.tl(true, 'o', 'gravity link click', co);

    // Send exit beacon if external URL
    if(omniIsExternalUrl(destUrl))
      omniGravExit(destUrl);
  }

  function omniIsExternalUrl(url) {
    var internalHosts = omniLinkInternalFilters.split(','),
        numInternalHosts = internalHosts.length,
        subjectHost = hostFromUrl(url).toLowerCase(),
        isExternal = true;

    for(var i=0; i<numInternalHosts; ++i) {
      var internalHost = internalHosts[i].toLowerCase(),
          posOfInternalInSubject;

      if(internalHost === subjectHost || (
        internalHost.charAt(0) === '.'
        && (posOfInternalInSubject = subjectHost.indexOf(internalHost)) != -1  // Internal wildcard matches subject
        && posOfInternalInSubject === subjectHost.length - internalHost.length // Internal tails subject
      )) {
        isExternal = false;
        break;
      }
    }

    return isExternal;
  }

  function omniGravExit(destUrl) {
    var ce = {};

    //Exit Link tracking should go to the aolsvc report suite
    ce.un='aolsvc';
    ce.linkTrackVars = 'prop50,prop51';

    var aolDoPlugins = window.s_265.doPlugins;
    window.s_265.doPlugins = function(s_265) {
      aolDoPlugins.apply(this, arguments);
      ce.prop50=s_265.prop50=hostFromUrl(destUrl);
      ce.prop51=s_265.prop51=window.s_265.prop23;
    };

    //send the exit link request
    window.s_265.tl(true,'e',urlSansQuery(destUrl),ce);
  }

  function hostFromUrl(url) {
    var matches = /^[^:]+:\/\/([^\/]+)/.exec(url);
    return matches && matches[1] || '';
  }

  function urlSansQuery(url) {
    return url.replace(/\?.*/, '');
  }
})($grv);