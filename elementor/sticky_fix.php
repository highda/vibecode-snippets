function replace_elementor_sticky_scripts() {
    add_action('wp_enqueue_scripts', function() {
        wp_add_inline_script('jquery', 'console.log("PHP: Running script replacement function.");', 'before');

        if (wp_script_is('e-sticky', 'registered')) {
            wp_deregister_script('e-sticky');
            wp_add_inline_script('jquery', 'console.log("PHP: Successfully deregistered Elementor\'s original sticky script.");', 'before');
            
            wp_register_script(
                'e-sticky',
                false, 
                ['elementor-pro-frontend'],
                '1.0.0',
                true
            );

            $custom_sticky_js = '
                console.log("Attempting to load custom sticky!");
                (function($) {
                    console.log("Custom sticky script loaded successfully!");

                    var Sticky = function(element, userSettings) {
                        var $element,
                            isSticky = false,
                            isFollowingParent = false,
                            isReachedEffectsPoint = false,
                            elements = {},
                            settings;
                    
                        var defaultSettings = {
                            to: "top",
                            offset: 0,
                            effectsOffset: 0,
                            parent: false,
                            classes: {
                                sticky: "sticky",
                                stickyActive: "sticky-active",
                                stickyEffects: "sticky-effects",
                                spacer: "sticky-spacer",
                            },
                        };
                    
                        var isScrolling = false;
                        var rafId = null;
                        var scrollTimeoutId = null;
                        var isStickyByDefault = false;
                        var layoutCache = {};
                    
                        var initSettings = function() {
                            settings = jQuery.extend(true, defaultSettings, userSettings);
                        };
                    
                        var initElements = function() {
                            $element = $(element).addClass(settings.classes.sticky);
                            elements.$window = $(window);
                            if (settings.parent) {
                                elements.$parent = $element.parent();
                                if (settings.parent !== "parent") {
                                    elements.$parent = elements.$parent.closest(settings.parent);
                                }
                            }
                        };
                    
                        var bindEvents = function() {
                            elements.$window.on({
                                scroll: onWindowScroll,
                                resize: debounce(onWindowResize, 100),
                            });
                        };
                    
                        var unbindEvents = function() {
                            elements.$window
                                .off("scroll", onWindowScroll)
                                .off("resize", onWindowResize);
                        };
                    
                        var backupCSS = function($el, key, props) {
                            var css = {},
                                style = $el[0].style;
                            props.forEach(function(p) {
                                css[p] = undefined !== style[p] ? style[p] : "";
                            });
                            $el.data("css-backup-" + key, css);
                        };
                    
                        var getCSSBackup = function($el, key) {
                            return $el.data("css-backup-" + key);
                        };
                    
                        var addSpacer = function() {
                            // Only add spacer if the element is not already fixed.
                            if ($element.css("position") !== "fixed" && !elements.$spacer) {
                                elements.$spacer = $element.clone()
                                    .addClass(settings.classes.spacer)
                                    .css({
                                        visibility: "hidden",
                                        transition: "none",
                                        animation: "none",
                                    });
                                $element.after(elements.$spacer);
                            }
                        };
                    
                        var removeSpacer = function() {
                            if (elements.$spacer) {
                                elements.$spacer.remove();
                                elements.$spacer = null;
                            }
                        };
                    
                        var stickElement = function() {
                            backupCSS($element, "unsticky", ["position", "width", "margin-top", "margin-bottom", "top", "bottom"]);
                            var css = {
                                position: "fixed",
                                width: getElementOuterSize($element, "width"),
                                marginTop: 0,
                                marginBottom: 0,
                            };
                            css[settings.to] = settings.offset;
                            css[settings.to === "top" ? "bottom" : "top"] = "";
                            $element
                                .css(css)
                                .addClass(settings.classes.stickyActive);
                        };
                    
                        var unstickElement = function() {
                            $element
                                .css(getCSSBackup($element, "unsticky"))
                                .removeClass(settings.classes.stickyActive);
                        };
                    
                        var followParent = function() {
                            backupCSS(elements.$parent, "childNotFollowing", ["position"]);
                            elements.$parent.css("position", "relative");
                            backupCSS($element, "notFollowing", ["position", "top", "bottom"]);
                            var css = { position: "absolute" };
                            css[settings.to === "top" ? "bottom" : "top"] = 0;
                            css[settings.to] = "";
                            $element.css(css);
                            isFollowingParent = true;
                        };
                    
                        var unfollowParent = function() {
                            elements.$parent.css(getCSSBackup(elements.$parent, "childNotFollowing"));
                            $element.css(getCSSBackup($element, "notFollowing"));
                            isFollowingParent = false;
                        };
                    
                        var getElementOuterSize = function($el, dimension) {
                            return $el[0].getBoundingClientRect()[dimension];
                        };
                    
                        var getElementViewportOffset = function($el, key) {
                            if (layoutCache[key]) return layoutCache[key];
                    
                            var windowScrollTop = elements.$window.scrollTop();
                            var el = $el[0];
                            var rect = el.getBoundingClientRect();
                            var fromTop = rect.top;
                            var fromBottom = rect.top - window.innerHeight;
                            var height = rect.height;
                    
                            var offset = {
                                top: {
                                    fromTop,
                                    fromBottom,
                                },
                                bottom: {
                                    fromTop: fromTop + height,
                                    fromBottom: fromBottom + height,
                                },
                            };
                    
                            layoutCache[key] = offset;
                            return offset;
                        };
                    
                        var checkParent = function() {
                            var elementOffset = getElementViewportOffset($element, "el");
                            var isTop = settings.to === "top";
                            if (isFollowingParent) {
                                var needUnfollow = isTop ? elementOffset.top.fromTop > settings.offset : elementOffset.bottom.fromBottom < -settings.offset;
                                if (needUnfollow) {
                                    unfollowParent();
                                }
                            } else {
                                var parentOffset = getElementViewportOffset(elements.$parent, "parent");
                                var parentStyle = getComputedStyle(elements.$parent[0]);
                                var borderWidth = parseFloat(parentStyle[isTop ? "borderBottomWidth" : "borderTopWidth"]) || 0;
                                var parentViewportDistance = isTop
                                    ? parentOffset.bottom.fromTop - borderWidth
                                    : parentOffset.top.fromBottom + borderWidth;
                                var needFollow = isTop
                                    ? parentViewportDistance <= elementOffset.bottom.fromTop
                                    : parentViewportDistance >= elementOffset.top.fromBottom;
                                if (needFollow) {
                                    followParent();
                                }
                            }
                        };
                    
                        var checkEffectsPoint = function(distance) {
                            if (isReachedEffectsPoint && -distance < settings.effectsOffset) {
                                $element.removeClass(settings.classes.stickyEffects);
                                isReachedEffectsPoint = false;
                            } else if (!isReachedEffectsPoint && -distance >= settings.effectsOffset) {
                                $element.addClass(settings.classes.stickyEffects);
                                isReachedEffectsPoint = true;
                            }
                        };
                    
                        var checkPosition = function() {
                            layoutCache = {};
                            var offset = settings.offset;
                            var distance;
                            if (isSticky) {
                                var spacerOffset = getElementViewportOffset(elements.$spacer || $element, "spacer");
                                distance = settings.to === "top"
                                    ? spacerOffset.top.fromTop - offset
                                    : -spacerOffset.bottom.fromBottom - offset;
                                if (settings.parent) checkParent();
                                if (distance > 0) {
                                    unstick();
                                }
                            } else {
                                var elOffset = getElementViewportOffset($element, "el");
                                distance = settings.to === "top"
                                    ? elOffset.top.fromTop - offset
                                    : -elOffset.bottom.fromBottom - offset;
                                if (distance <= 0) {
                                    stick();
                                    if (settings.parent) checkParent();
                                }
                            }
                            checkEffectsPoint(distance);
                        };
                    
                        var stick = function() {
                            addSpacer();
                            stickElement();
                            isSticky = true;
                            $element.trigger("sticky:stick");
                        };
                    
                        var unstick = function() {
                            unstickElement();
                            removeSpacer();
                            isSticky = false;
                            $element.trigger("sticky:unstick");
                        };
                    
                        var onWindowScroll = function() {
                            isScrolling = true;
                            if (!rafId) rafId = requestAnimationFrame(tick);
                            if (scrollTimeoutId) clearTimeout(scrollTimeoutId);
                            scrollTimeoutId = setTimeout(function() {
                                isScrolling = false;
                            }, 150);
                        };
                    
                        var tick = function() {
                            checkPosition();
                            if (isScrolling) {
                                rafId = requestAnimationFrame(tick);
                            } else {
                                rafId = null;
                            }
                        };
                    
                        var onWindowResize = function() {
                            window.requestAnimationFrame(function() {
                                if (!isSticky) return;
                                unstickElement();
                                stickElement();
                                if (settings.parent) {
                                    isFollowingParent = false;
                                    checkParent();
                                }
                                checkPosition();
                            });
                        };
                    
                        function debounce(fn, wait) {
                            var timeout;
                            return function() {
                                var context = this;
                                var args = arguments;
                                var later = function() {
                                    timeout = null;
                                    fn.apply(context, args);
                                };
                                clearTimeout(timeout);
                                timeout = setTimeout(later, wait);
                            };
                        }
                    
                        this.destroy = function() {
                            if (isSticky) unstick();
                            unbindEvents();
                            $element.removeClass(settings.classes.sticky);
                            if (rafId) {
                                cancelAnimationFrame(rafId);
                                rafId = null;
                            }
                        };
                    
                        (function init() {
                            initSettings();
                            initElements();
                            isStickyByDefault = $element.css("position") === "fixed";
                            bindEvents();
                            checkPosition();
                        })();
                    };
                
                    $.fn.sticky = function(settings) {
                        var isCommand = typeof settings === "string";
                        this.each(function() {
                            var $this = $(this);
                            if (!isCommand) {
                                $this.data("sticky", new Sticky(this, settings));
                                return;
                            }
                            var instance = $this.data("sticky");
                            if (!instance) throw new Error("Trying to perform the `" + settings + "` method prior to initialization");
                            if (!instance[settings]) throw new ReferenceError("Method `" + settings + "` not found in sticky instance");
                            instance[settings].apply(instance, Array.prototype.slice.call(arguments, 1));
                            if (settings === "destroy") {
                                $this.removeData("sticky");
                            }
                        });
                        return this;
                    };
                
                    window.Sticky = Sticky;
                
                })(jQuery);';
            
            wp_add_inline_script('e-sticky', $custom_sticky_js, 'after');
        }
    });

    add_action('wp_enqueue_scripts', 'replace_elementor_sticky_scripts', 999);
}

replace_elementor_sticky_scripts();
