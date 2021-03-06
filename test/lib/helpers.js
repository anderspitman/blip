var React = require('react');

var container;

var helpers = {
  mountComponent: function(component) {
    if (!container) {
      container = document.createElement('div');
    }
    document.documentElement.appendChild(container);
    return React.renderComponent(component, container);
  },

  unmountComponent: function() {
    React.unmountComponentAtNode(container);
    document.documentElement.removeChild(container);
  }
};

module.exports = helpers;
