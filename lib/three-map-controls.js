var _ = require('lodash');

module.exports = (function(THREE){

    THREE.MapControls = function ( object, domElement, options ) {

        //
        // Public Variables
        //

        this.object = object;

        this.domElement = ( domElement !== undefined ) ? domElement : document;

        // Set to false to disable this control
        this.enabled = true;

        this.target;

        // How far you can dolly in and out ( PerspectiveCamera only )
        this.minDistance = 0;
        this.maxDistance = Infinity;

        // Set to true to enable damping (inertia)
        // If damping is enabled, you must call controls.update() in your animation loop
        this.enableDamping = true;
        this.dampingFactor = 0.25;

        // This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
        // Set to false to disable zooming
        this.enableZoom = true;
        this.zoomSpeed = 4.0;

        // Set to false to disable panning
        this.enablePan = true;
        this.keyPanSpeed = 12.0;	// pixels moved per arrow key push


        // Set to false to disable use of the keys
        this.enableKeys = true;

        // The four arrow keys
        this.keys = { LEFT: 37, UP: 38, RIGHT: 39, BOTTOM: 40 };

        // Mouse buttons
        this.mouseButtons = { ZOOM: THREE.MOUSE.MIDDLE, PAN: THREE.MOUSE.LEFT };

        //Copy options from parameters
        _.extend(this, options);

        // for reset
        this.target0 = this.target.clone();
        this.position0 = this.object.position.clone();
        this.zoom0 = this.object.zoom;


        //
        // private vars
        //

        var scope = this;

        var changeEvent = { type: 'change' };
        var startEvent = { type: 'start' };
        var endEvent = { type: 'end' };

        var STATE = { NONE : - 1, DOLLY : 1, PAN : 2, TOUCH_DOLLY : 4, TOUCH_PAN : 5 };

        var state = STATE.NONE;

        var EPS = 0.000001;


        var targetZoom = this.maxDistance;
        var currentZoom = this.maxDistance;

        var panTarget = new THREE.Vector3();
        var panCurrent = new THREE.Vector3();

        var minZoomPosition = new THREE.Vector3();
        var maxZoomPosition = new THREE.Vector3();

        var panStart = new THREE.Vector2();
        var panEnd = new THREE.Vector2();
        var panDelta = new THREE.Vector2();

        var dollyStart = new THREE.Vector2();
        var dollyEnd = new THREE.Vector2();
        var dollyDelta = new THREE.Vector2();

        var camOrientation = new THREE.Vector2();
        var lastMouse = new THREE.Vector2();

        // Init (IIFE-style constructor)
        //

        (function(){
            //Raycast along target plane normal in both directions until we intersect plane; lookAt intersection point
            //(this is how we set initial orientation and zoom level of the camera)

            var intersection; //THREE.Vector3
            _.each([-1, 1], function(orientation){
                if(intersection)
                    return;
                var r = new THREE.Ray(scope.object.position, scope.target.normal.clone().multiplyScalar(orientation));
                intersection = r.intersectPlane(scope.target);
            });

            maxZoomPosition.copy(intersection);
            scope.object.lookAt(maxZoomPosition); //set the orientation of the camera towards the map.

            var camToPlane = maxZoomPosition.clone().sub(scope.object.position);

            currentZoom = targetZoom = camToPlane.length();
            camOrientation = camToPlane.clone().normalize();

            minZoomPosition.copy(calculateMinZoom(scope.object.position, maxZoomPosition));

        })();

        //
        // Public functions
        //

        this.reset = function () {

            scope.target.copy( scope.target0 );
            scope.object.position.copy( scope.position0 );
            scope.object.zoom = scope.zoom0;

            scope.object.updateProjectionMatrix();
            scope.dispatchEvent( changeEvent );

            scope.update();

            state = STATE.NONE;

        };

        // this method is exposed, but perhaps it would be better if we can make it private...
        this.update = function() {

            var offset = new THREE.Vector3();
            var offsetMaxZoom = new THREE.Vector3();
            var offsetMinZoom = new THREE.Vector3();

            return function update () {

                var position = scope.object.position;

                offsetMaxZoom.copy( maxZoomPosition ).sub( panCurrent );
                offsetMinZoom.copy( minZoomPosition ).sub( panCurrent );

                // move target to panned location
                panCurrent.lerp( panTarget, 0.1 );

                maxZoomPosition.copy( panCurrent ).add( offsetMaxZoom );
                minZoomPosition.copy( panCurrent ).add( offsetMinZoom );

                position.lerpVectors(minZoomPosition, maxZoomPosition, getZoomAlpha());

                return false;

            };

        }();

        this.dispose = function() {

            scope.domElement.removeEventListener( 'contextmenu', onContextMenu, false );
            scope.domElement.removeEventListener( 'mousedown', onMouseDown, false );
            scope.domElement.removeEventListener( 'mousewheel', onMouseWheel, false );
            scope.domElement.removeEventListener( 'MozMousePixelScroll', onMouseWheel, false ); // firefox

            scope.domElement.removeEventListener( 'touchstart', onTouchStart, false );
            scope.domElement.removeEventListener( 'touchend', onTouchEnd, false );
            scope.domElement.removeEventListener( 'touchmove', onTouchMove, false );

            document.removeEventListener( 'mousemove', onMouseMove, false );
            document.removeEventListener( 'mouseup', onMouseUp, false );

            window.removeEventListener( 'keydown', onKeyDown, false );

            //scope.dispatchEvent( { type: 'dispose' } ); // should this be added here?

        };

        //
        // Private functions
        //

        function getZoomAlpha(){
            targetZoom = Math.max( scope.minDistance, Math.min( scope.maxDistance, targetZoom ) );
            var diff = currentZoom - targetZoom;
            var alpha = 0.1;
            currentZoom -= diff * alpha;

            return 1 - (currentZoom / scope.maxDistance);
        }


        function getZoomScale() {

            return Math.pow( 0.95, scope.zoomSpeed );

        }


        var panLeft = function() {

            var v = new THREE.Vector3();

            return function panLeft( distance, objectMatrix ) {

                v.setFromMatrixColumn( objectMatrix, 0 ); // get X column of objectMatrix
                v.multiplyScalar( - distance );

                panTarget.add( v );

            };

        }();

        var panUp = function() {

            var v = new THREE.Vector3();

            return function panUp( distance, objectMatrix ) {

                v.setFromMatrixColumn( objectMatrix, 1 ); // get Y column of objectMatrix
                v.multiplyScalar( distance );

                panTarget.add( v );

            };

        }();

        // deltaX and deltaY are in pixels; right and down are positive
        var pan = function() {

            return function pan ( deltaX, deltaY ) {


                var element = scope.domElement === document ? scope.domElement.body : scope.domElement;

                var r = new THREE.Ray(scope.object.position, camOrientation);
                var targetDistance = r.distanceToPlane(scope.target);

                // half of the fov is center to top of screen
                targetDistance *= Math.tan( ( scope.object.fov / 2 ) * Math.PI / 180.0 );

                // we actually don't use screenWidth, since perspective camera is fixed to screen height
                panLeft( 2 * deltaX * targetDistance / element.clientHeight, scope.object.matrix );
                panUp( 2 * deltaY * targetDistance / element.clientHeight, scope.object.matrix );


            };

        }();

        function dollyIn( dollyScale ) {

            if ( scope.object instanceof THREE.PerspectiveCamera ) {

                targetZoom /= dollyScale;

            } else {

                console.warn( 'WARNING: MapControls.js encountered an unknown camera type - dolly/zoom disabled.' );
                scope.enableZoom = false;

            }

        }

        function dollyOut( dollyScale ) {

            if ( scope.object instanceof THREE.PerspectiveCamera ) {

                targetZoom *= dollyScale;

            } else {

                console.warn( 'WARNING: MapControls.js encountered an unknown camera type - dolly/zoom disabled.' );
                scope.enableZoom = false;

            }

        }



        function handleMouseDownDolly( event ) {

            //console.log( 'handleMouseDownDolly' );

            dollyStart.set( event.clientX, event.clientY );

        }

        function handleMouseDownPan( event ) {

            //console.log( 'handleMouseDownPan' );

            panStart.set( event.clientX, event.clientY );

        }



        function handleMouseMoveDolly( event ) {

            //console.log( 'handleMouseMoveDolly' );

            dollyEnd.set( event.clientX, event.clientY );

            dollyDelta.subVectors( dollyEnd, dollyStart );

            if ( dollyDelta.y > 0 ) {

                dollyIn( getZoomScale() );

            } else if ( dollyDelta.y < 0 ) {

                dollyOut( getZoomScale() );

            }

            dollyStart.copy( dollyEnd );

            scope.update();

        }

        function handleMouseMovePan( event ) {

            //console.log( 'handleMouseMovePan' );

            panEnd.set( event.clientX, event.clientY );

            panDelta.subVectors( panEnd, panStart );

            pan( panDelta.x, panDelta.y );

            panStart.copy( panEnd );

            scope.update();

        }

        function handleMouseUp( event ) {

            //console.log( 'handleMouseUp' );

        }

        function calculateMinZoom(cam_pos, maxzoom_pos){
            return maxzoom_pos.clone().add(
                cam_pos.clone()
                        .sub(maxzoom_pos)
                        .normalize()
                        .multiplyScalar(scope.maxDistance)
                );
        }

        function handleMouseWheel( event ) {

            //console.log( 'handleMouseWheel' );
            var mouse = new THREE.Vector2();

            mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
            mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;

            if(!mouse.equals(lastMouse)){
                lastMouse.copy(mouse);

                var raycaster = new THREE.Raycaster();

                raycaster.setFromCamera(mouse, object);

                // calculate objects intersecting the picking ray
                var intersect = raycaster.ray.intersectPlane(scope.target);

                if(intersect){
                    maxZoomPosition.copy(intersect);
                    minZoomPosition.copy(calculateMinZoom(scope.object.position, maxZoomPosition));

                    targetZoom = currentZoom = maxZoomPosition.clone().sub(scope.object.position).length();
                }
            }

            var delta = 0;

            if ( event.wheelDelta !== undefined ) {

                // WebKit / Opera / Explorer 9

                delta = event.wheelDelta;

            } else if ( event.detail !== undefined ) {

                // Firefox

                delta = - event.detail;

            }

            if ( delta > 0 ) {
                dollyOut( getZoomScale() );
            } else if ( delta < 0 ) {
                dollyIn( getZoomScale() );
            }



            scope.update();

        }

        function handleKeyDown( event ) {

            //console.log( 'handleKeyDown' );

            switch ( event.keyCode ) {

                case scope.keys.UP:
                    pan( 0, scope.keyPanSpeed );
                    scope.update();
                    break;

                case scope.keys.BOTTOM:
                    pan( 0, - scope.keyPanSpeed );
                    scope.update();
                    break;

                case scope.keys.LEFT:
                    pan( scope.keyPanSpeed, 0 );
                    scope.update();
                    break;

                case scope.keys.RIGHT:
                    pan( - scope.keyPanSpeed, 0 );
                    scope.update();
                    break;

            }

        }

        function handleTouchStartDolly( event ) {

            //console.log( 'handleTouchStartDolly' );

            var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
            var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;

            var distance = Math.sqrt( dx * dx + dy * dy );

            dollyStart.set( 0, distance );

        }

        function handleTouchStartPan( event ) {

            //console.log( 'handleTouchStartPan' );

            panStart.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

        }


        function handleTouchMoveDolly( event ) {

            //console.log( 'handleTouchMoveDolly' );

            var dx = event.touches[ 0 ].pageX - event.touches[ 1 ].pageX;
            var dy = event.touches[ 0 ].pageY - event.touches[ 1 ].pageY;

            var distance = Math.sqrt( dx * dx + dy * dy );

            dollyEnd.set( 0, distance );

            dollyDelta.subVectors( dollyEnd, dollyStart );

            if ( dollyDelta.y > 0 ) {

                dollyOut( getZoomScale() );

            } else if ( dollyDelta.y < 0 ) {

                dollyIn( getZoomScale() );

            }

            dollyStart.copy( dollyEnd );

            scope.update();

        }

        function handleTouchMovePan( event ) {

            //console.log( 'handleTouchMovePan' );

            panEnd.set( event.touches[ 0 ].pageX, event.touches[ 0 ].pageY );

            panDelta.subVectors( panEnd, panStart );

            pan( panDelta.x, panDelta.y );

            panStart.copy( panEnd );

            scope.update();

        }

        function handleTouchEnd( event ) {

            //console.log( 'handleTouchEnd' );

        }

        //
        // event handlers - FSM: listen for events and reset state
        //

        function onMouseDown( event ) {

            if ( scope.enabled === false ) return;

            event.preventDefault();

            if ( event.button === scope.mouseButtons.ZOOM ) {

                if ( scope.enableZoom === false ) return;

                handleMouseDownDolly( event );

                state = STATE.DOLLY;

            } else if ( event.button === scope.mouseButtons.PAN ) {

                if ( scope.enablePan === false ) return;

                handleMouseDownPan( event );

                state = STATE.PAN;

            }

            if ( state !== STATE.NONE ) {

                document.addEventListener( 'mousemove', onMouseMove, false );
                document.addEventListener( 'mouseup', onMouseUp, false );

                scope.dispatchEvent( startEvent );

            }

        }

        function onMouseMove( event ) {

            if ( scope.enabled === false ) return;

            event.preventDefault();

            if ( state === STATE.DOLLY ) {

                if ( scope.enableZoom === false ) return;

                handleMouseMoveDolly( event );

            } else if ( state === STATE.PAN ) {

                if ( scope.enablePan === false ) return;

                handleMouseMovePan( event );

            }

        }

        function onMouseUp( event ) {

            if ( scope.enabled === false ) return;

            handleMouseUp( event );

            document.removeEventListener( 'mousemove', onMouseMove, false );
            document.removeEventListener( 'mouseup', onMouseUp, false );

            scope.dispatchEvent( endEvent );

            state = STATE.NONE;

        }

        function onMouseWheel( event ) {

            if ( scope.enabled === false || scope.enableZoom === false || ( state !== STATE.NONE ) ) return;

            event.preventDefault();
            event.stopPropagation();

            handleMouseWheel( event );

            scope.dispatchEvent( startEvent ); // not sure why these are here...
            scope.dispatchEvent( endEvent );

        }

        function onKeyDown( event ) {

            if ( scope.enabled === false || scope.enableKeys === false || scope.enablePan === false ) return;

            handleKeyDown( event );

        }

        function onTouchStart( event ) {

            if ( scope.enabled === false ) return;

            switch ( event.touches.length ) {
                case 1: // three-fingered touch: pan

                    if ( scope.enablePan === false ) return;

                    handleTouchStartPan( event );

                    state = STATE.TOUCH_PAN;

                    break;

                case 2:	// two-fingered touch: dolly

                    if ( scope.enableZoom === false ) return;

                    handleTouchStartDolly( event );

                    state = STATE.TOUCH_DOLLY;

                    break;

                default:

                    state = STATE.NONE;

            }

            if ( state !== STATE.NONE ) {

                scope.dispatchEvent( startEvent );

            }

        }

        function onTouchMove( event ) {

            if ( scope.enabled === false ) return;

            event.preventDefault();
            event.stopPropagation();

            switch ( event.touches.length ) {

                case 1: // one-fingered touch: pan
                    if ( scope.enablePan === false ) return;
                    if ( state !== STATE.TOUCH_PAN ) return; // is this needed?...

                    handleTouchMovePan( event );

                    break;

                case 2: // two-fingered touch: dolly

                    if ( scope.enableZoom === false ) return;
                    if ( state !== STATE.TOUCH_DOLLY ) return; // is this needed?...

                    handleTouchMoveDolly( event );

                    break;

                default:

                    state = STATE.NONE;

            }

        }

        function onTouchEnd( event ) {

            if ( scope.enabled === false ) return;

            handleTouchEnd( event );

            scope.dispatchEvent( endEvent );

            state = STATE.NONE;

        }

        function onContextMenu( event ) {

            event.preventDefault();

        }

        //

        scope.domElement.addEventListener( 'contextmenu', onContextMenu, false );

        scope.domElement.addEventListener( 'mousedown', onMouseDown, false );
        scope.domElement.addEventListener( 'mousewheel', onMouseWheel, false );
        scope.domElement.addEventListener( 'MozMousePixelScroll', onMouseWheel, false ); // firefox

        scope.domElement.addEventListener( 'touchstart', onTouchStart, false );
        scope.domElement.addEventListener( 'touchend', onTouchEnd, false );
        scope.domElement.addEventListener( 'touchmove', onTouchMove, false );

        window.addEventListener( 'keydown', onKeyDown, false );

        // force an update at start

        this.update();

    };

    THREE.MapControls.prototype = Object.create( THREE.EventDispatcher.prototype );
    THREE.MapControls.prototype.constructor = THREE.MapControls;

    return THREE.MapControls;

})(window.THREE || require('three'));