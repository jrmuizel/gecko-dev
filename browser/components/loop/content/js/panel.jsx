/** @jsx React.DOM */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/*jshint newcap:false*/
/*global loop:true, React */

var loop = loop || {};
loop.panel = (function(_, mozL10n) {
  "use strict";

  var sharedViews = loop.shared.views;
  var sharedModels = loop.shared.models;
  var sharedMixins = loop.shared.mixins;
  var __ = mozL10n.get; // aliasing translation function as __ for concision

  /**
   * Panel router.
   * @type {loop.desktopRouter.DesktopRouter}
   */
  var router;

  var TabView = React.createClass({
    getInitialState: function() {
      return {
        selectedTab: "call"
      };
    },

    handleSelectTab: function(event) {
      var tabName = event.target.dataset.tabName;
      this.setState({selectedTab: tabName});

      if (this.props.onSelect) {
        this.props.onSelect(tabName);
      }
    },

    render: function() {
      var cx = React.addons.classSet;
      var tabButtons = [];
      var tabs = [];
      React.Children.forEach(this.props.children, function(tab, i) {
        var tabName = tab.props.name;
        var isSelected = (this.state.selectedTab == tabName);
        tabButtons.push(
          <li className={cx({selected: isSelected})}
              key={i}
              data-tab-name={tabName}
              onClick={this.handleSelectTab}>
          </li>
        );
        tabs.push(
          <div key={i} className={cx({tab: true, selected: isSelected})}>
            {tab.props.children}
          </div>
        );
      }, this);
      return (
        <div className="tab-view-container">
          <ul className="tab-view">{tabButtons}</ul>
          {tabs}
        </div>
      );
    }
  });

  var Tab = React.createClass({
    render: function() {
      return null;
    }
  });

  /**
   * Availability drop down menu subview.
   */
  var AvailabilityDropdown = React.createClass({
    mixins: [sharedMixins.DropdownMenuMixin],

    getInitialState: function() {
      return {
        doNotDisturb: navigator.mozLoop.doNotDisturb
      };
    },

    // XXX target event can either be the li, the span or the i tag
    // this makes it easier to figure out the target by making a
    // closure with the desired status already passed in.
    changeAvailability: function(newAvailabilty) {
      return function(event) {
        // Note: side effect!
        switch (newAvailabilty) {
          case 'available':
            this.setState({doNotDisturb: false});
            navigator.mozLoop.doNotDisturb = false;
            break;
          case 'do-not-disturb':
            this.setState({doNotDisturb: true});
            navigator.mozLoop.doNotDisturb = true;
            break;
        }
        this.hideDropdownMenu();
      }.bind(this);
    },

    render: function() {
      // XXX https://github.com/facebook/react/issues/310 for === htmlFor
      var cx = React.addons.classSet;
      var availabilityStatus = cx({
        'status': true,
        'status-dnd': this.state.doNotDisturb,
        'status-available': !this.state.doNotDisturb
      });
      var availabilityDropdown = cx({
        'dropdown-menu': true,
        'hide': !this.state.showMenu
      });
      var availabilityText = this.state.doNotDisturb ?
                              __("display_name_dnd_status") :
                              __("display_name_available_status");

      return (
        <div className="dropdown">
          <p className="dnd-status" onClick={this.showDropdownMenu}>
            <span>{availabilityText}</span>
            <i className={availabilityStatus}></i>
          </p>
          <ul className={availabilityDropdown}
              onMouseLeave={this.hideDropdownMenu}>
            <li onClick={this.changeAvailability("available")}
                className="dropdown-menu-item dnd-make-available">
              <i className="status status-available"></i>
              <span>{__("display_name_available_status")}</span>
            </li>
            <li onClick={this.changeAvailability("do-not-disturb")}
                className="dropdown-menu-item dnd-make-unavailable">
              <i className="status status-dnd"></i>
              <span>{__("display_name_dnd_status")}</span>
            </li>
          </ul>
        </div>
      );
    }
  });

  var ToSView = React.createClass({
    getInitialState: function() {
      return {seenToS: navigator.mozLoop.getLoopCharPref('seenToS')};
    },

    render: function() {
      if (this.state.seenToS == "unseen") {
        var terms_of_use_url = navigator.mozLoop.getLoopCharPref('legal.ToS_url');
        var privacy_notice_url = navigator.mozLoop.getLoopCharPref('legal.privacy_url');
        var tosHTML = __("legal_text_and_links3", {
          "clientShortname": __("client_shortname_fallback"),
          "terms_of_use": React.renderComponentToStaticMarkup(
            <a href={terms_of_use_url} target="_blank">
              {__("legal_text_tos")}
            </a>
          ),
          "privacy_notice": React.renderComponentToStaticMarkup(
            <a href={privacy_notice_url} target="_blank">
              {__("legal_text_privacy")}
            </a>
          ),
        });
        return <p className="terms-service"
                  dangerouslySetInnerHTML={{__html: tosHTML}}></p>;
      } else {
        return <div />;
      }
    }
  });

  /**
   * Panel settings (gear) menu entry.
   */
  var SettingsDropdownEntry = React.createClass({
    propTypes: {
      onClick: React.PropTypes.func.isRequired,
      label: React.PropTypes.string.isRequired,
      icon: React.PropTypes.string,
      displayed: React.PropTypes.bool
    },

    getDefaultProps: function() {
      return {displayed: true};
    },

    render: function() {
      if (!this.props.displayed) {
        return null;
      }
      return (
        <li onClick={this.props.onClick} className="dropdown-menu-item">
          {this.props.icon ?
            <i className={"icon icon-" + this.props.icon}></i> :
            null}
          <span>{this.props.label}</span>
        </li>
      );
    }
  });

  /**
   * Panel settings (gear) menu.
   */
  var SettingsDropdown = React.createClass({
    mixins: [sharedMixins.DropdownMenuMixin],

    handleClickSettingsEntry: function() {
      // XXX to be implemented
    },

    handleClickAccountEntry: function() {
      // XXX to be implemented
    },

    handleClickAuthEntry: function() {
      if (this._isSignedIn()) {
        navigator.mozLoop.logOutFromFxA();
      } else {
        navigator.mozLoop.logInToFxA();
      }
    },

    _isSignedIn: function() {
      return !!navigator.mozLoop.userProfile;
    },

    render: function() {
      var cx = React.addons.classSet;
      return (
        <div className="settings-menu dropdown">
          <a className="btn btn-settings" onClick={this.showDropdownMenu}
             title={__("settings_menu_button_tooltip")} />
          <ul className={cx({"dropdown-menu": true, hide: !this.state.showMenu})}
              onMouseLeave={this.hideDropdownMenu}>
            <SettingsDropdownEntry label={__("settings_menu_item_settings")}
                                   onClick={this.handleClickSettingsEntry}
                                   icon="settings" />
            <SettingsDropdownEntry label={__("settings_menu_item_account")}
                                   onClick={this.handleClickAccountEntry}
                                   icon="account"
                                   displayed={this._isSignedIn()} />
            <SettingsDropdownEntry label={this._isSignedIn() ?
                                          __("settings_menu_item_signout") :
                                          __("settings_menu_item_signin")}
                                   onClick={this.handleClickAuthEntry}
                                   icon={this._isSignedIn() ? "signout" : "signin"} />
          </ul>
        </div>
      );
    }
  });

  /**
   * Panel layout.
   */
  var PanelLayout = React.createClass({
    propTypes: {
      summary: React.PropTypes.string.isRequired
    },

    render: function() {
      return (
        <div className="share generate-url">
          <div className="description">{this.props.summary}</div>
          <div className="action">
            {this.props.children}
          </div>
        </div>
      );
    }
  });

  /**
   * Call url result view.
   */
  var CallUrlResult = React.createClass({
    mixins: [sharedMixins.DocumentVisibilityMixin],

    propTypes: {
      callUrl:        React.PropTypes.string,
      callUrlExpiry:  React.PropTypes.number,
      notifications:  React.PropTypes.object.isRequired,
      client:         React.PropTypes.object.isRequired
    },

    getInitialState: function() {
      return {
        pending: false,
        copied: false,
        callUrl: this.props.callUrl || "",
        callUrlExpiry: 0
      };
    },

    /**
     * Provided by DocumentVisibilityMixin. Schedules retrieval of a new call
     * URL everytime the panel is reopened.
     */
    onDocumentVisible: function() {
      this._fetchCallUrl();
    },

    /**
    * Returns a random 5 character string used to identify
    * the conversation.
    * XXX this will go away once the backend changes
    */
    conversationIdentifier: function() {
      return Math.random().toString(36).substring(5);
    },

    componentDidMount: function() {
      // If we've already got a callURL, don't bother requesting a new one.
      // As of this writing, only used for visual testing in the UI showcase.
      if (this.state.callUrl.length) {
        return;
      }

      this._fetchCallUrl();
    },

    /**
     * Fetches a call URL.
     */
    _fetchCallUrl: function() {
      this.setState({pending: true});
      this.props.client.requestCallUrl(this.conversationIdentifier(),
                                       this._onCallUrlReceived);
    },

    _onCallUrlReceived: function(err, callUrlData) {
      this.props.notifications.reset();

      if (err) {
        this.props.notifications.errorL10n("unable_retrieve_url");
        this.setState(this.getInitialState());
      } else {
        try {
          var callUrl = new window.URL(callUrlData.callUrl);
          // XXX the current server vers does not implement the callToken field
          // but it exists in the API. This workaround should be removed in the future
          var token = callUrlData.callToken ||
                      callUrl.pathname.split('/').pop();

          this.setState({pending: false, copied: false,
                         callUrl: callUrl.href,
                         callUrlExpiry: callUrlData.expiresAt});
        } catch(e) {
          console.log(e);
          this.props.notifications.errorL10n("unable_retrieve_url");
          this.setState(this.getInitialState());
        }
      }
    },

    handleEmailButtonClick: function(event) {
      this.handleLinkExfiltration(event);

      navigator.mozLoop.composeEmail(__("share_email_subject3"),
        __("share_email_body3", { callUrl: this.state.callUrl }));
    },

    handleCopyButtonClick: function(event) {
      this.handleLinkExfiltration(event);
      // XXX the mozLoop object should be passed as a prop, to ease testing and
      //     using a fake implementation in UI components showcase.
      navigator.mozLoop.copyString(this.state.callUrl);
      this.setState({copied: true});
    },

    handleLinkExfiltration: function(event) {
      // TODO Bug 1015988 -- Increase link exfiltration telemetry count
      if (this.state.callUrlExpiry) {
        navigator.mozLoop.noteCallUrlExpiry(this.state.callUrlExpiry);
      }
    },

    render: function() {
      // XXX setting elem value from a state (in the callUrl input)
      // makes it immutable ie read only but that is fine in our case.
      // readOnly attr will suppress a warning regarding this issue
      // from the react lib.
      var cx = React.addons.classSet;
      var inputCSSClass = cx({
        "pending": this.state.pending,
        // Used in functional testing, signals that
        // call url was received from loop server
         "callUrl": !this.state.pending
      });
      return (
        <PanelLayout summary={__("share_link_header_text")}>
          <div className="invite">
            <input type="url" value={this.state.callUrl} readOnly="true"
                   onCopy={this.handleLinkExfiltration}
                   className={inputCSSClass} />
            <p className="btn-group url-actions">
              <button className="btn btn-email" disabled={!this.state.callUrl}
                onClick={this.handleEmailButtonClick}>
                {__("share_button")}
              </button>
              <button className="btn btn-copy" disabled={!this.state.callUrl}
                onClick={this.handleCopyButtonClick}>
                {this.state.copied ? __("copied_url_button") :
                                     __("copy_url_button")}
              </button>
            </p>
          </div>
        </PanelLayout>
      );
    }
  });

  /**
   * FxA sign in/up link component.
   */
  var AuthLink = React.createClass({
    handleSignUpLinkClick: function() {
      navigator.mozLoop.logInToFxA();
    },

    render: function() {
      if (navigator.mozLoop.loggedInToFxA) { // XXX to be implemented
        return null;
      }
      return (
        <p className="signin-link">
          <a href="#" onClick={this.handleSignUpLinkClick}>
            {__("panel_footer_signin_or_signup_link")}
          </a>
        </p>
      );
    }
  });

  /**
   * FxA user identity (guest/authenticated) component.
   */
  var UserIdentity = React.createClass({
    render: function() {
      return (
        <p className="user-identity">
          {this.props.displayName}
        </p>
      );
    }
  });

  /**
   * Panel view.
   */
  var PanelView = React.createClass({
    propTypes: {
      notifications: React.PropTypes.object.isRequired,
      client: React.PropTypes.object.isRequired,
      // Mostly used for UI components showcase and unit tests
      callUrl: React.PropTypes.string,
      userProfile: React.PropTypes.object,
    },

    getInitialState: function() {
      return {
        userProfile: this.props.userProfile || navigator.mozLoop.userProfile,
      };
    },

    _onAuthStatusChange: function() {
      this.setState({userProfile: navigator.mozLoop.userProfile});
    },

    componentDidMount: function() {
      window.addEventListener("LoopStatusChanged", this._onAuthStatusChange);
    },

    componentWillUnmount: function() {
      window.removeEventListener("LoopStatusChanged", this._onAuthStatusChange);
    },

    render: function() {
      var NotificationListView = sharedViews.NotificationListView;
      var displayName = this.state.userProfile && this.state.userProfile.email ||
                        __("display_name_guest");
      return (
        <div>
          <NotificationListView notifications={this.props.notifications}
                                clearOnDocumentHidden={true} />
          <TabView onSelect={this.selectTab}>
            <Tab name="call">
              <CallUrlResult client={this.props.client}
                             notifications={this.props.notifications}
                             callUrl={this.props.callUrl} />
              <ToSView />
            </Tab>
            <Tab name="contacts">
              <span>contacts</span>
            </Tab>
          </TabView>
          <div className="footer">
            <div className="user-details">
              <UserIdentity displayName={displayName} />
              <AvailabilityDropdown />
            </div>
            <AuthLink />
            <SettingsDropdown />
          </div>
        </div>
      );
    }
  });

  /**
   * Panel initialisation.
   */
  function init() {
    // Do the initial L10n setup, we do this before anything
    // else to ensure the L10n environment is setup correctly.
    mozL10n.initialize(navigator.mozLoop);

    var client = new loop.Client();
    var notifications = new sharedModels.NotificationCollection()

    React.renderComponent(<PanelView
      client={client}
      notifications={notifications} />, document.querySelector("#main"));

    document.body.classList.add(loop.shared.utils.getTargetPlatform());
    document.body.setAttribute("dir", mozL10n.getDirection());

    // Notify the window that we've finished initalization and initial layout
    var evtObject = document.createEvent('Event');
    evtObject.initEvent('loopPanelInitialized', true, false);
    window.dispatchEvent(evtObject);
  }

  return {
    init: init,
    UserIdentity: UserIdentity,
    AvailabilityDropdown: AvailabilityDropdown,
    CallUrlResult: CallUrlResult,
    PanelView: PanelView,
    SettingsDropdown: SettingsDropdown,
    ToSView: ToSView
  };
})(_, document.mozL10n);

document.addEventListener('DOMContentLoaded', loop.panel.init);
